import { describe, expect, test } from "bun:test";
import { megaFlixGatewayAdapter } from "../../src/playback/adapters/megaflix-gateway";
import { playbackAdapters } from "../../src/playback/registry";

describe("native playback providers", () => {
  test("MegaFrix is the primary native provider (Player 1)", () => {
    expect(playbackAdapters[0]?.id).toBe("megafrix");
    expect(playbackAdapters[0]?.priority).toBeLessThan(
      playbackAdapters.find((a) => a.id === "megaflix")?.priority ?? 0,
    );
  });

  test("keeps owned gateway and authorized media as fallbacks", () => {
    const native = playbackAdapters.filter((a) => a.nativeMedia);
    expect(native.map((a) => a.id)).toEqual(["megafrix", "megaflix", "authorized-media"]);
    expect(megaFlixGatewayAdapter.nativeMedia).toBe(true);
  });
});
