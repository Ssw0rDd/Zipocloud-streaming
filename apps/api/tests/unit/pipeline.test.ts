import { describe, expect, it } from "bun:test";
import {
  buildFfmpegArgs,
  serializeFfmpegHeaders,
  StreamPipeline,
  StreamPipelineError,
} from "../../src/media/pipeline";

describe("authorized stream pipeline", () => {
  it("builds a copy-only, fast-start ffmpeg command with input headers", () => {
    const args = buildFfmpegArgs({
      streamUrl: "https://media.example.test/master.m3u8?token=signed",
      headers: { Referer: "https://app.example.test/", Authorization: "Bearer token" },
      outputPath: "movie.mp4",
    }, "movie.tmp.mp4");

    expect(args).toContain("-c");
    expect(args).toContain("copy");
    expect(args).toContain("+faststart");
    expect(args[args.indexOf("-headers") + 1]).toBe(
      "Referer: https://app.example.test/\r\nAuthorization: Bearer token\r\n",
    );
    expect(args.at(-1)).toBe("movie.tmp.mp4");
  });

  it("rejects header injection and URL credentials", () => {
    expect(() => serializeFfmpegHeaders({ Authorization: "ok\r\nX-Evil: yes" })).toThrow();
    expect(() => buildFfmpegArgs({
      streamUrl: "https://user:password@media.example.test/file.mp4",
      headers: {},
      outputPath: "movie.mp4",
    }, "movie.tmp.mp4")).toThrow();
  });

  it("retries a missing ffmpeg binary three times and returns a detailed error", async () => {
    const pipeline = new StreamPipeline({
      streamUrl: "https://media.example.test/file.mp4",
      headers: {},
      outputPath: "test-results/missing-binary.mp4",
      timeoutMs: 1_000,
      ffmpegPath: "zipo-ffmpeg-binary-that-does-not-exist",
    });
    pipeline.on("error", () => undefined);

    const error = await pipeline.start().catch((caught) => caught);
    expect(error).toBeInstanceOf(StreamPipelineError);
    expect((error as StreamPipelineError).attempts).toBe(3);
  });
});
