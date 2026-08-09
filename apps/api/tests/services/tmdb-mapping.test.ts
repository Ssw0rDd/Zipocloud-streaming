import { describe, expect, test } from "bun:test";
import {
  setManualTmdbOverride,
  shouldReuseCachedMapping,
} from "../../src/services/content-id-mapping";
import {
  animeTitleVariants,
  findTmdbEpisodeTarget,
  inferAnimeSeasonNumber,
  normalizeTitle,
  selectUniqueAnimeCandidate,
  type TmdbSearchHit,
} from "../../src/services/tmdb";

const candidate = (
  tmdbId: number,
  title: string,
  year: number,
): TmdbSearchHit => ({ tmdbId, title, year });

describe("TMDB matching", () => {
  test("normalizes accents and punctuation", () => {
    expect(normalizeTitle("Pokémon: Horizons!")).toBe("pokemon horizons");
  });

  test("accepts one normalized title with compatible year", () => {
    expect(
      selectUniqueAnimeCandidate(
        [candidate(1, "Sousou no Frieren", 2023)],
        ["Sousou no Frieren"],
        2023,
      )?.tmdbId,
    ).toBe(1);
  });

  test("fails closed on ambiguity", () => {
    expect(
      selectUniqueAnimeCandidate(
        [
          candidate(1, "Monster", 2004),
          candidate(2, "Monster", 2004),
        ],
        ["Monster"],
        2004,
      ),
    ).toBeNull();
  });

  test("rejects incompatible year", () => {
    expect(
      selectUniqueAnimeCandidate(
        [candidate(1, "Monster", 1990)],
        ["Monster"],
        2004,
      ),
    ).toBeNull();
  });

  test("derives the franchise title and season from sequel titles", () => {
    expect(inferAnimeSeasonNumber([
      "Frieren: Beyond Journey's End Season 2",
      "Sousou no Frieren 2nd Season",
    ])).toBe(2);
    expect(
      animeTitleVariants(["Sousou no Frieren 2nd Season"]),
    ).toContain("Sousou no Frieren");
  });

  test("maps an anime episode to the real TMDB episode by title", () => {
    expect(
      findTmdbEpisodeTarget(
        [
          {
            episode_number: 29,
            season_number: 1,
            name: "Shall We Go, Then?",
            air_date: "2026-01-16",
            still_path: "/frieren-29.jpg",
          },
        ],
        { title: "Shall We Go, Then?", airDate: "2026-01-16" },
      ),
    ).toEqual({
      season: 1,
      episode: 29,
      stillUrl: "https://image.tmdb.org/t/p/w300/frieren-29.jpg",
    });
  });

  test("retries transient anime not-found mappings", () => {
    expect(
      shouldReuseCachedMapping("anime", {
        tmdbId: null,
        status: "not_found",
      }),
    ).toBe(false);
    expect(
      shouldReuseCachedMapping("anime", {
        tmdbId: null,
        status: "ambiguous",
      }),
    ).toBe(true);
    expect(
      shouldReuseCachedMapping("anime", {
        tmdbId: 209867,
        status: "resolved",
      }),
    ).toBe(true);
  });

  test("manual override validates before database access", async () => {
    await expect(
      setManualTmdbOverride("anime", "1", 0),
    ).rejects.toThrow("positive integer");
  });
});
