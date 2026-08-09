import { describe, expect, test } from "bun:test";
import {
  LOCALE_REGISTRY,
  SUPPORTED_LOCALES,
  normalizeLocale,
  toTmdbLocale,
} from "@zipo/shared";
import { pickAnimeTitle } from "../../src/services/content-localize";
import { mergeLocalizedAnimeEpisodes } from "../../src/services/episode-thumbnails";

describe("locale registry", () => {
  test("contains the complete nine-locale matrix", () => {
    expect(SUPPORTED_LOCALES).toEqual([
      "pt", "en", "es", "fr", "de", "it", "ja", "ko", "zh",
    ]);
    for (const locale of SUPPORTED_LOCALES) {
      expect(toTmdbLocale(locale)).toBe(LOCALE_REGISTRY[locale].tmdb);
    }
  });

  test("normalizes regional tags and rejects unsupported locales", () => {
    expect(normalizeLocale("pt-PT")).toBe("pt");
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("ru-RU")).toBe("en");
  });

  test("never labels a native anime title as a western translation", () => {
    const titles = {
      english: "Frieren: Beyond Journey's End",
      romaji: "Sousou no Frieren",
      native: "葬送のフリーレン",
    };
    for (const locale of ["pt", "es", "fr", "de", "it", "ko", "zh"]) {
      expect(pickAnimeTitle(titles, locale)).toBe(titles.english);
    }
    expect(pickAnimeTitle(titles, "ja")).toBe(titles.native);
  });
});

describe("anime episode localization", () => {
  test("keeps MAL numbering while applying the matching localized TMDB title", () => {
    const localized = mergeLocalizedAnimeEpisodes(
      [
        {
          id: "59978-1",
          number: 1,
          season: 1,
          title: "Shall We Go, Then?",
          airDate: "2026-01-16",
        },
      ],
      [
        {
          season_number: 1,
          episode_number: 29,
          name: "Shall We Go, Then?",
          air_date: "2026-01-16",
        },
      ],
      [
        {
          season_number: 1,
          episode_number: 29,
          name: "Vamos, então?",
          overview: "Frieren segue para sua próxima jornada.",
          air_date: "2026-01-16",
        },
      ],
    );
    expect(localized[0]).toMatchObject({
      number: 1,
      title: "Vamos, então?",
      description: "Frieren segue para sua próxima jornada.",
    });
  });

  test("does not replace a useful title with a generic localized label", () => {
    const localized = mergeLocalizedAnimeEpisodes(
      [{ id: "1", number: 1, title: "A Hero Returns", airDate: "2026-01-01" }],
      [
        {
          season_number: 1,
          episode_number: 1,
          name: "A Hero Returns",
          air_date: "2026-01-01",
        },
      ],
      [{ season_number: 1, episode_number: 1, name: "Episódio 1" }],
    );
    expect(localized[0]?.title).toBe("A Hero Returns");
  });
});
