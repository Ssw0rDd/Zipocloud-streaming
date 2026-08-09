import { describe, expect, test } from "bun:test";
import type { ContentItem } from "@zipo/shared";
import {
  recommendationEventWeight,
  rerankRecommendationDiversity,
} from "../../src/services/recommendations";

function item(id: string, genre: string): ContentItem {
  return { id, type: "movie", title: id, genres: [genre], isAdult: false };
}

describe("recommendations v2", () => {
  test("uses qualified behavior and explicit feedback as stronger signals", () => {
    expect(recommendationEventWeight("qualified_play")).toBeGreaterThan(
      recommendationEventWeight("detail"),
    );
    expect(recommendationEventWeight("like")).toBeGreaterThan(
      recommendationEventWeight("qualified_play"),
    );
    expect(recommendationEventWeight("hide")).toBeLessThan(0);
  });

  test("penalizes repetitive dominant genres without discarding relevance", () => {
    const result = rerankRecommendationDiversity([
      { item: item("a", "Drama"), score: 10 },
      { item: item("b", "Drama"), score: 9 },
      { item: item("c", "Drama"), score: 8 },
      { item: item("d", "Comedy"), score: 7.8 },
    ], 3);
    expect(result.map((entry) => entry.item.id)).toContain("d");
    expect(result[0]?.item.id).toBe("a");
  });
});
