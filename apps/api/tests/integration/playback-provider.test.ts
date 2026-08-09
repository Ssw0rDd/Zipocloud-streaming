import { describe, expect, test } from "bun:test";
import { playbackRoutes } from "../../src/routes/playback";

describe("playback provider route", () => {
  test("returns all configured adapter types", async () => {
    const response = await playbackRoutes.handle(
      new Request("http://localhost/api/v1/playback/providers"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      providers: Array<{ id: string }>;
    };
    expect(body.providers.map((provider) => provider.id)).toEqual([
      "megaflix",
      "megafrix",
      "authorized-media",
      "superflix",
      "warezcdn",
      "videasy",
      "vidlink",
      "vidking",
      "vidsrc",
      "twoembed",
    ]);
  });
});
