import { describe, expect, test } from "bun:test";
import type { EmbedSource } from "@zipo/shared";
import {
  isClipEligibleServer,
  resolveClipEligibleSource,
} from "../../src/playback/sessions";

describe("clip source eligibility", () => {
  test("only Player 1 MegaFrix HLS is clip-eligible", () => {
    expect(
      isClipEligibleServer({
        id: "server-1",
        providerId: "megafrix",
        type: "hls",
      }),
    ).toBe(true);
    expect(
      isClipEligibleServer({
        id: "server-2",
        providerId: "megafrix",
        type: "hls",
      }),
    ).toBe(false);
    expect(
      isClipEligibleServer({
        id: "server-1",
        providerId: "megafrix",
        type: "mp4",
      }),
    ).toBe(false);
    expect(
      isClipEligibleServer({
        id: "server-1",
        providerId: "superflix",
        type: "hls",
      }),
    ).toBe(false);
  });

  test("resolveClipEligibleSource picks MegaFrix HLS when it is Player 1", () => {
    const sources: EmbedSource[] = [
      {
        type: "mp4",
        url: "https://cdn.example/video.mp4",
        providerId: "superflix",
        label: "SuperFlix",
      },
      {
        type: "hls",
        url: "https://cdn.example/master.m3u8",
        providerId: "megafrix",
        label: "MegaFrix · Dublado",
      },
    ];
    const clipSource = resolveClipEligibleSource(sources);
    expect(clipSource?.providerId).toBe("megafrix");
    expect(clipSource?.type).toBe("hls");
    expect(clipSource?.url).toContain(".m3u8");
  });

  test("resolveClipEligibleSource returns null when Player 1 is not MegaFrix HLS", () => {
    const sources: EmbedSource[] = [
      {
        type: "mp4",
        url: "https://cdn.example/only.mp4",
        providerId: "superflix",
      },
    ];
    expect(resolveClipEligibleSource(sources)).toBeNull();
  });
});
