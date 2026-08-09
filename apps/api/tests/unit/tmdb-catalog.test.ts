import { describe, expect, test } from "bun:test";
import {
  mapTmdbCatalogHitToItem,
  toTmdbGenreIds,
} from "../../src/services/tmdb";

describe("tmdb catalog mapping", () => {
  test("maps canonical genres to TMDB discover IDs", () => {
    expect(toTmdbGenreIds("movie", ["action", "comedy"])).toEqual([28, 35]);
    expect(toTmdbGenreIds("series", ["action", "science-fiction"])).toEqual([
      10759,
      10765,
    ]);
    expect(toTmdbGenreIds("movie", ["sports", "supernatural"])).toEqual([]);
  });

  test("maps catalog hits with IMDb id preferred, TMDB id as fallback", () => {
    expect(
      mapTmdbCatalogHitToItem(
        {
          tmdbId: 1,
          title: "No Imdb",
          genres: ["Action"],
        },
        "movie",
      ),
    ).toMatchObject({
      id: "1",
      type: "movie",
      externalIds: { tmdb: 1 },
    });

    const mapped = mapTmdbCatalogHitToItem(
      {
        tmdbId: 550,
        imdbId: "tt0137523",
        title: "Fight Club",
        genres: ["Drama"],
        poster: "https://image.tmdb.org/t/p/w500/x.jpg",
        year: 1999,
        rating: 8.4,
      },
      "movie",
    );
    expect(mapped).toMatchObject({
      id: "tt0137523",
      type: "movie",
      title: "Fight Club",
      externalIds: { imdb: "tt0137523", tmdb: 550 },
    });
  });
});
