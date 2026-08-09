import { describe, expect, test } from "bun:test";
import {
  buildTwoEmbedUrl,
  buildVideasyUrl,
  buildVidkingUrl,
  buildVidlinkUrl,
  buildVidsrcUrl,
} from "../../src/playback/adapters/documented-embeds";
import {
  parseVoltzEmbedUrl,
  validateVoltzMediaUrl,
} from "../../src/playback/adapters/megafrix";

describe("documented playback embeds", () => {
  test("builds themed Videasy TMDB URLs", async () => {
    const movie = await buildVideasyUrl({ type: "movie", id: "x", tmdbId: 299534 });
    expect(movie).toBe("https://player.videasy.net/movie/299534?color=7daa5a&overlay=true&nextbutton=false");

    const series = await buildVideasyUrl({
      type: "series",
      id: "x",
      tmdbId: 1399,
      season: 1,
      episode: 1,
    });
    expect(series).toContain("/tv/1399/1/1");
    expect(series).toContain("nextEpisode=true");
  });

  test("keeps VidKing limited to documented movie and TV contracts", async () => {
    expect(
      await buildVidkingUrl({ type: "movie", id: "x", tmdbId: 1078605 }),
    ).toBe("https://www.vidking.net/embed/movie/1078605?color=7daa5a&autoPlay=false");
    expect(await buildVidkingUrl({ type: "anime", id: "59978" })).toBeNull();
  });

  test("uses MAL directly for VidLink anime", async () => {
    const url = await buildVidlinkUrl({
      type: "anime",
      id: "59978",
      episode: 1,
      audioLang: "pt-BR",
    });
    expect(url).toContain("https://vidlink.pro/anime/59978/1/dub");
    expect(url).toContain("primaryColor=7daa5a");
    expect(url).toContain("fallback=true");
  });

  test("builds only the observed experimental VidSrc watch route", async () => {
    expect(
      await buildVidsrcUrl({
        type: "series",
        id: "x",
        tmdbId: 1399,
        season: 2,
        episode: 3,
      }),
    ).toBe("https://vidsrc.win/watch/1399?s=2&e=3&color=7daa5a&autoPlay=false");
  });

  test("builds 2Embed movie and TV contracts", async () => {
    expect(
      await buildTwoEmbedUrl({ type: "movie", id: "x", tmdbId: 609681 }),
    ).toBe("https://www.2embed.cc/embed/609681?color=7daa5a&theme=dark&autostart=0");
    expect(
      await buildTwoEmbedUrl({
        type: "series",
        id: "x",
        tmdbId: 60735,
        season: 1,
        episode: 1,
      }),
    ).toBe("https://www.2embed.cc/embedtv/60735&s=1&e=1?color=7daa5a&theme=dark&autostart=0");
    expect(await buildTwoEmbedUrl({ type: "anime", id: "5114", episode: 1 })).toBeNull();
  });
});

describe("MegaFrix Voltz allowlists", () => {
  test("accepts only the exact embed route and parameters", () => {
    expect(
      parseVoltzEmbedUrl(
        "https://vods.faz-o-eli.online/voltz.php?type=episode&id=16173534",
      )?.hostname,
    ).toBe("vods.faz-o-eli.online");
    expect(
      parseVoltzEmbedUrl(
        "https://vods.faz-o-eli.online/voltz.php?type=episode&id=1&url=https://evil.test",
      ),
    ).toBeNull();
  });

  test("rejects arbitrary MP4 hosts", () => {
    expect(
      validateVoltzMediaUrl(
        "https://wa001.vod01e001.fun/video/file.mp4?verify=abc&expire=1999999999",
      )?.hostname,
    ).toBe("wa001.vod01e001.fun");
    expect(
      validateVoltzMediaUrl(
        "https://evil.test/video/file.mp4?verify=abc&expire=1999999999",
      ),
    ).toBeNull();
  });
});
