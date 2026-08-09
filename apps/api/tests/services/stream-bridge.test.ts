import { describe, expect, test } from "bun:test";
import {
  cinemaPrepServerId,
  parseCinemaPrepServerId,
  toBridgeMediaPreparation,
} from "../../src/services/stream-bridge";

describe("stream bridge helpers", () => {
  test("maps cinema prep server ids", () => {
    const jobId = "abc123def456ghi789jkl012";
    expect(cinemaPrepServerId(jobId)).toBe(`cinema-prep:${jobId}`);
    expect(parseCinemaPrepServerId(`cinema-prep:${jobId}`)).toBe(jobId);
    expect(parseCinemaPrepServerId("server-1")).toBeNull();
  });

  test("maps bridge job payload to media preparation", () => {
    const preparation = toBridgeMediaPreparation({
      jobId: "abc123def456ghi789jkl012",
      status: "processing",
      progress: 42,
    });
    expect(preparation.status).toBe("processing");
    expect(preparation.progress).toBe(42);
    expect(preparation.retryAfterSeconds).toBe(2);
  });
});
