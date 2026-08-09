import { describe, expect, test } from "bun:test";
import {
  buildSuperflixEmbedUrl,
  parseSuperflixBaseUrl,
} from "../../src/playback/adapters/superflix";
import {
  parseMegaFrixItem,
  parseMegaFrixSearchIds,
  parseMegaFrixVideoPayload,
  parseRola3EmbedUrl,
} from "../../src/playback/adapters/megafrix";
import { listProviderCatalog } from "../../src/playback/orchestrator";
import {
  evaluatePlaybackAvailability,
  parseSuperflixIdList,
  type SuperflixCatalogSnapshot,
} from "../../src/services/superflix-catalog";

describe("SuperFlix URL builder", () => {
  test("builds movie URL with TMDB preferred", () => {
    expect(
      buildSuperflixEmbedUrl({
        type: "movie",
        imdbId: "tt0068646",
        tmdbId: 238,
      }),
    ).toBe(
      "https://superflixapi.pro/filme/238#noEpList#noLink#transparent#color:7daa5a",
    );
  });

  test("uses IMDb only when TMDB is unavailable", () => {
    expect(
      buildSuperflixEmbedUrl({ type: "movie", imdbId: "tt0068646" }),
    ).toContain("/filme/tt0068646#noEpList");
  });

  test("builds series and anime with positive season and episode", () => {
    expect(
      buildSuperflixEmbedUrl({
        type: "series",
        tmdbId: 1396,
        season: 1,
        episode: 2,
      }),
    ).toContain("/serie/1396/1/2#noEpList");
  });

  test.each([
    ["http://superflixapi.pro", null],
    ["https://user:pass@superflixapi.pro", null],
    ["https://superflixapi.pro/path", null],
    ["https://superflixapi.pro?next=https://evil.test", null],
  ])("rejects unsafe base %s", (base, expected) => {
    expect(parseSuperflixBaseUrl(base)).toBe(expected);
  });

  test.each([
    { type: "movie" as const, imdbId: "tt1" },
    { type: "series" as const, tmdbId: 1, season: 0, episode: 1 },
    { type: "series" as const, tmdbId: 1, season: 1, episode: -1 },
    { type: "anime" as const, tmdbId: 0, season: 1, episode: 1 },
  ])("rejects invalid playback identifiers %#", (input) => {
    expect(buildSuperflixEmbedUrl(input)).toBeNull();
  });
});

describe("Playback providers and catalog", () => {
  test("registry exposes providers in fallback order", () => {
    expect(listProviderCatalog()).toEqual([
      {
        id: "megafrix",
        label: "MegaFrix",
        supportedTypes: ["movie", "series", "anime"],
        priority: -200,
      },
      {
        id: "megaflix",
        label: "MegaFlix",
        supportedTypes: ["movie", "series", "anime"],
        priority: -100,
      },
      {
        id: "authorized-media",
        label: "ZiPo",
        supportedTypes: ["movie", "series", "anime"],
        priority: 0,
      },
      {
        id: "superflix",
        label: "ZiPo · SuperFlix",
        supportedTypes: ["movie", "series", "anime"],
        priority: 1,
      },
      {
        id: "warezcdn",
        label: "ZiPo · WarezCDN",
        supportedTypes: ["movie", "series", "anime"],
        priority: 2,
      },
      {
        id: "videasy",
        label: "ZiPo · Videasy",
        supportedTypes: ["movie", "series", "anime"],
        priority: 4,
      },
      {
        id: "vidlink",
        label: "ZiPo · VidLink",
        supportedTypes: ["movie", "series", "anime"],
        priority: 5,
      },
      {
        id: "vidking",
        label: "ZiPo · VidKing",
        supportedTypes: ["movie", "series"],
        priority: 6,
      },
      {
        id: "vidsrc",
        label: "ZiPo · VidSrc",
        supportedTypes: ["movie", "series"],
        priority: 7,
      },
      {
        id: "twoembed",
        label: "ZiPo · 2Embed",
        supportedTypes: ["movie", "series"],
        priority: 8,
      },
    ]);
  });

  test("builds the WarezCDN-compatible contract", () => {
    expect(
      buildSuperflixEmbedUrl({
        type: "series",
        tmdbId: 1396,
        season: 1,
        episode: 1,
        baseUrl: "https://warezcdn.lat",
      }),
    ).toBe(
      "https://warezcdn.lat/serie/1396/1/1#noEpList#noLink#transparent#color:7daa5a",
    );
  });

  test("parses supported list response shapes", () => {
    expect(parseSuperflixIdList({ data: [{ imdb_id: "tt0068646" }] }, "imdb"))
      .toEqual(["tt0068646"]);
    expect(parseSuperflixIdList({ ids: ["1396", 1399] }, "tmdb"))
      .toEqual([1396, 1399]);
  });

  test("returns available, unavailable and unknown", () => {
    const now = Date.now();
    const snapshot: SuperflixCatalogSnapshot = {
      version: 1,
      fetchedAt: new Date(now).toISOString(),
      movies: ["tt0068646"],
      movieTmdb: [238],
      series: [1396],
      anime: [46260],
    };
    expect(
      evaluatePlaybackAvailability({
        snapshot,
        type: "movie",
        imdbId: "tt0068646",
        now,
      }),
    ).toBe("available");
    expect(
      evaluatePlaybackAvailability({
        snapshot,
        type: "movie",
        tmdbId: 238,
        now,
      }),
    ).toBe("available");
    expect(
      evaluatePlaybackAvailability({
        snapshot,
        type: "series",
        tmdbId: 1,
        now,
      }),
    ).toBe("unavailable");
    expect(
      evaluatePlaybackAvailability({
        snapshot,
        type: "series",
        tmdbId: 1,
        now,
        hasUnindexedFallback: true,
      }),
    ).toBe("unknown");
    expect(
      evaluatePlaybackAvailability({
        snapshot: { ...snapshot, fetchedAt: new Date(now - 10_000).toISOString() },
        type: "anime",
        tmdbId: 46260,
        now,
        maxAgeMs: 1_000,
      }),
    ).toBe("unknown");
  });
});

describe("MegaFrix response parsing", () => {
  test("extracts unique internal IDs with a hard limit", () => {
    expect(
      parseMegaFrixSearchIds(
        '<a onclick="openItem(10824)"></a><a onclick="openItem(10824)"></a><a onclick="openItem(378)"></a>',
      ),
    ).toEqual([10824, 378]);
  });

  test("extracts external IDs without executing remote scripts", () => {
    expect(
      parseMegaFrixItem(`
        <script>
          var item = {
            id: 10824,
            title: "A Casa do Dragão",
            tmdb_id: "94997",
            imdb_id: "tt11198330",
            movie: false
          }
          var idItem = 10824;
        </script>
      `),
    ).toEqual({
      internalId: 10824,
      title: "A Casa do Dragão",
      tmdbId: 94997,
      imdbId: "tt11198330",
      movie: false,
    });
  });

  test("rejects malformed item blocks", () => {
    expect(parseMegaFrixItem("var item = { title: 'missing id' };"))
      .toBeNull();
  });

  test("accepts only the exact supported rola3 extractor URL", () => {
    expect(
      parseRola3EmbedUrl(
        "https://embedplayer2.xyz/rola3/6f2af23439be08c207d3bc696cdb115e",
      ),
    ).toEqual({
      origin: "https://embedplayer2.xyz",
      hash: "6f2af23439be08c207d3bc696cdb115e",
    });
    expect(
      parseRola3EmbedUrl(
        "https://evil.test/rola3/6f2af23439be08c207d3bc696cdb115e",
      ),
    ).toBeNull();
    expect(
      parseRola3EmbedUrl(
        "https://user:pass@embedplayer2.xyz/rola3/6f2af23439be08c207d3bc696cdb115e",
      ),
    ).toBeNull();
  });

  test("prefers signed HLS and rejects arbitrary media origins", () => {
    const signed =
      "https://embedplayer2.xyz/cdn/hls/6f2af23439be08c207d3bc696cdb115e/master.m3u8?expires=1999999999&token=x";
    expect(
      parseMegaFrixVideoPayload({
        securedLink: signed,
        videoSource:
          "https://embedplayer2.xyz/cdn/hls/6f2af23439be08c207d3bc696cdb115e/master.txt",
      }),
    ).toBe(signed);
    expect(
      parseMegaFrixVideoPayload({
        securedLink: "https://evil.test/cdn/hls/6f2af23439be08c207d3bc696cdb115e/master.m3u8",
      }),
    ).toBeNull();
  });
});
