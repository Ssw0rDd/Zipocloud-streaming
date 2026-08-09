import { describe, expect, test } from "bun:test";
import { featuredQuerySchema } from "@zipo/shared";
import { detectAdultContent } from "../../src/services/adult-filter";

describe("detectAdultContent", () => {
  test("flags Jikan Rx / explicit hentai metadata", () => {
    expect(
      detectAdultContent({
        rating: "Rx - Hentai",
        title: "Some Show",
      }),
    ).toBe(true);
    expect(
      detectAdultContent({
        genres: ["Hentai"],
        title: "Bloom Into You",
      }),
    ).toBe(true);
    expect(
      detectAdultContent({
        tags: ["hentai"],
        title: "Catalog Entry",
      }),
    ).toBe(true);
  });

  test("does not flag common non-adult titles/ratings", () => {
    expect(
      detectAdultContent({
        rating: "PG-13 - Teens 13 or older",
        genres: ["Action", "Adventure"],
        title: "Frieren: Beyond Journey's End",
      }),
    ).toBe(false);
    expect(
      detectAdultContent({
        rating: "R - 17+ (violence & profanity)",
        genres: ["Action"],
        title: "Attack on Titan",
      }),
    ).toBe(false);
  });
});

describe("includeAdult query parsing", () => {
  test("string false stays false (z.coerce.boolean footgun)", () => {
    expect(featuredQuerySchema.parse({ includeAdult: "false" }).includeAdult).toBe(
      false,
    );
    expect(featuredQuerySchema.parse({ includeAdult: "true" }).includeAdult).toBe(
      true,
    );
    expect(featuredQuerySchema.parse({}).includeAdult).toBe(false);
  });
});
