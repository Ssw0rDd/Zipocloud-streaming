import { describe, expect, test } from "bun:test";
import type { EmbedSource } from "@zipo/shared";
import { env } from "../../src/env";
import { rewritePreparedManifest } from "../../src/media/preparation";
import {
  resolveSecureEmbeds,
  toSecureEmbed,
} from "../../src/playback/secure-embed";
import {
  withPlaybackAvailability,
  type SuperflixCatalogSnapshot,
} from "../../src/services/superflix-catalog";

describe("secure playback fallback", () => {
  test("accepts only a sandbox-compatible source on its configured origin", () => {
    const base = new URL(env.VIDEASY_BASE_URL);
    const source: EmbedSource = {
      type: "iframe",
      url: new URL("/movie/238", base).toString(),
      label: "Videasy",
      providerId: "videasy",
      capabilities: {
        mode: "provider-iframe",
        handoffToProvider: true,
        requiresUnsandboxedFrame: false,
      },
    };
    expect(toSecureEmbed(source)).toMatchObject({
      providerId: "videasy",
      referrerPolicy: "no-referrer",
      sandbox: "allow-scripts allow-same-origin allow-forms allow-presentation",
    });
    expect(toSecureEmbed({ ...source, url: "https://evil.example/movie/238" })).toBeNull();
  });

  test("accepts SuperFlix as an origin-checked unsandboxed embed", () => {
    expect(toSecureEmbed({
      type: "iframe",
      url: "https://superflixapi.pro/filme/238",
      providerId: "superflix",
      label: "SuperFlix",
      capabilities: {
        mode: "provider-iframe",
        requiresUnsandboxedFrame: true,
      },
    })).toMatchObject({
      providerId: "superflix",
      sandbox: null,
      referrerPolicy: "no-referrer",
    });
    expect(toSecureEmbed({
      type: "iframe",
      url: "https://evil.example/filme/238",
      providerId: "superflix",
      capabilities: {
        mode: "provider-iframe",
        requiresUnsandboxedFrame: true,
      },
    })).toBeNull();
  });

  test("returns catalog and sandboxed players as manual fallbacks", async () => {
    const embeds = await resolveSecureEmbeds({
      type: "movie",
      id: "tt0111161",
      tmdbId: 278,
    });
    const ids = embeds.map((embed) => embed.providerId);
    expect(ids).toContain("videasy");
    expect(ids).toContain("vidlink");
    expect(ids).toContain("vidking");
    if (env.SUPERFLIX_ENABLED) expect(ids).toContain("superflix");
    if (env.WAREZCDN_ENABLED) expect(ids).toContain("warezcdn");
    if (env.TWOEMBED_ENABLED) expect(ids).toContain("twoembed");
    if (env.VIDSRC_ENABLED) expect(ids).toContain("vidsrc");
    expect(
      embeds
        .filter((embed) => embed.sandbox != null)
        .every((embed) => embed.sandbox!.includes("allow-scripts")),
    ).toBe(true);
  });
});

describe("prepared HLS manifest", () => {
  test("rewrites only generated segment names", () => {
    const token = "a".repeat(43);
    expect(rewritePreparedManifest(
      "#EXTM3U\n#EXTINF:4,\nsegment-000001.ts\n",
      token,
    )).toContain(`segment-000001.ts?token=${token}`);
    expect(() => rewritePreparedManifest(
      "#EXTM3U\nhttps://evil.example/segment.ts\n",
      token,
    )).toThrow("Unsafe prepared manifest resource");
  });
});

describe("catalog versus playback availability", () => {
  test("does not advertise a catalog hit as native playback", async () => {
    const snapshot: SuperflixCatalogSnapshot = {
      version: 1,
      fetchedAt: new Date().toISOString(),
      movies: ["tt0068646"],
      movieTmdb: [238],
      series: [],
      anime: [],
    };
    const item = await withPlaybackAvailability({
      id: "tt0068646",
      type: "movie" as const,
      title: "The Godfather",
      isAdult: false,
      externalIds: { imdb: "tt0068646", tmdb: 238 },
    }, snapshot);
    expect(item.playbackAvailability).toBe("unknown");
    expect(item.playbackAccess).toEqual({
      mode: "unknown",
      catalogAvailability: "available",
      reason: "RESOLVE_REQUIRED",
    });
  });
});
