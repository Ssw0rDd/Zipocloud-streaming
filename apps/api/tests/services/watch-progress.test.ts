import { describe, expect, test } from "bun:test";
import { recordViewBodySchema } from "@zipo/shared";
import {
  canonicalEpisodeKey,
  normalizeWatchProgress,
  selectContinueProgress,
} from "../../src/services/watch-progress";

describe("canonicalEpisodeKey", () => {
  test("keeps movies and episodic progress in distinct stable keys", () => {
    expect(canonicalEpisodeKey({ contentType: "movie" })).toBe("movie");
    expect(canonicalEpisodeKey({
      contentType: "series",
      episodeId: "ep-42",
      seasonNumber: 4,
      episodeNumber: 7,
    })).toBe("id:ep-42");
    expect(canonicalEpisodeKey({
      contentType: "series",
      seasonNumber: 4,
      episodeNumber: 7,
    })).toBe("s:4:e:7");
    expect(canonicalEpisodeKey({
      contentType: "anime",
      episodeNumber: 7,
    })).toBe("s:1:e:7");
  });
});

describe("watch progress", () => {
  test("marks 95 percent as completed and clamps the position", () => {
    expect(
      normalizeWatchProgress({ progressSeconds: 960, durationSeconds: 1_000 }),
    ).toEqual({
      progressSeconds: 960,
      durationSeconds: 1_000,
      completed: true,
    });
    expect(
      normalizeWatchProgress({ progressSeconds: 1_200, durationSeconds: 1_000 }),
    ).toMatchObject({ progressSeconds: 1_000, completed: true });
  });

  test("a latest completion or reset suppresses older progress", () => {
    const rows = [
      { contentType: "series", contentId: "1", progressSeconds: 0, completed: false },
      { contentType: "series", contentId: "1", progressSeconds: 400, completed: false },
      { contentType: "movie", contentId: "tt1234567", progressSeconds: 950, completed: true },
      { contentType: "movie", contentId: "tt1234567", progressSeconds: 300, completed: false },
      { contentType: "anime", contentId: "20", progressSeconds: 120, completed: false },
    ];
    expect(selectContinueProgress(rows)).toEqual([rows[4]]);
  });

  test("validates episode snapshots and rejects unreasonable durations", () => {
    expect(
      recordViewBodySchema.safeParse({
        contentType: "anime",
        contentId: "59978",
        episodeId: "59978-1",
        seasonNumber: 1,
        episodeNumber: 1,
        progressSeconds: 321,
        durationSeconds: 1_400,
      }).success,
    ).toBe(true);
    expect(
      recordViewBodySchema.safeParse({
        contentType: "movie",
        contentId: "tt1234567",
        progressSeconds: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(false);
  });
});
