import { describe, expect, test } from "bun:test";
import type { ContentItem, HomeDocumentV3 } from "@zipo/shared";
import { homeV3ETag } from "../../src/aggregate/home-v3";

function sampleItem(id: string): ContentItem {
  return {
    id,
    type: "movie",
    title: `Title ${id}`,
    isAdult: false,
    poster: "https://image.tmdb.org/t/p/w500/x.jpg",
  };
}

function sampleDocument(overrides?: Partial<HomeDocumentV3["meta"]>): HomeDocumentV3 {
  return {
    data: {
      featured: {
        movies: [sampleItem("f1")],
        series: [],
        anime: [],
        source: "test",
      },
      sections: [
        { id: "movies", title: "Movies", type: "movie", items: [sampleItem("m1")] },
        { id: "series", title: "Series", type: "series", items: [] },
        { id: "anime", title: "Anime", type: "anime", items: [] },
      ],
    },
    meta: {
      generatedAt: "2026-07-21T12:00:00.000Z",
      stale: false,
      partial: false,
      cacheStatus: "fresh",
      ...overrides,
    },
  };
}

describe("home-v3 document shape", () => {
  test("HomeDocumentV3 exposes data.sections and cache meta fields", () => {
    const doc = sampleDocument({ cacheStatus: "stale", stale: true, partial: true });

    expect(doc.data.sections).toHaveLength(3);
    expect(doc.data.sections[0]).toMatchObject({
      id: "movies",
      type: "movie",
    });
    expect(Array.isArray(doc.data.sections[0].items)).toBe(true);
    expect(doc.meta).toEqual({
      generatedAt: "2026-07-21T12:00:00.000Z",
      stale: true,
      partial: true,
      cacheStatus: "stale",
    });
    expect(["fresh", "stale", "miss", "bypass"]).toContain(doc.meta.cacheStatus);
  });

  test("homeV3ETag is stable for locale + generatedAt", () => {
    const a = homeV3ETag("pt", "2026-07-21T12:00:00.000Z");
    const b = homeV3ETag("pt", "2026-07-21T12:00:00.000Z");
    const c = homeV3ETag("en", "2026-07-21T12:00:00.000Z");
    const nsfw = homeV3ETag("pt", "2026-07-21T12:00:00.000Z", "nsfw");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(nsfw);
    expect(a.startsWith('"h3-main-pt-')).toBe(true);
    expect(nsfw.startsWith('"h3-nsfw-pt-')).toBe(true);
  });
});
