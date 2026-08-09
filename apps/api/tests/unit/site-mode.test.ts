import { describe, expect, test } from "bun:test";
import {
  applySiteContentPolicy,
  resolveSiteMode,
} from "@zipo/shared";
import { detectAdultContent } from "../../src/services/adult-filter";

describe("site mode dual catalog", () => {
  test("resolves nsfw from header or origin", () => {
    expect(
      resolveSiteMode({
        header: "nsfw",
        nsfwFrontendUrl: "http://localhost:3002",
      }),
    ).toBe("nsfw");
    expect(
      resolveSiteMode({
        origin: "http://localhost:3002",
        nsfwFrontendUrl: "http://localhost:3002",
      }),
    ).toBe("nsfw");
    expect(
      resolveSiteMode({
        origin: "http://localhost:3000",
        nsfwFrontendUrl: "http://localhost:3002",
      }),
    ).toBe("main");
  });

  test("policy strips adult on main and keeps only adult on nsfw", () => {
    const items = [
      { id: "1", isAdult: false },
      { id: "2", isAdult: true },
    ];
    expect(applySiteContentPolicy(items, "main").map((i) => i.id)).toEqual(["1"]);
    expect(applySiteContentPolicy(items, "nsfw").map((i) => i.id)).toEqual(["2"]);
  });

  test("detects ecchi and pornographic signals", () => {
    expect(detectAdultContent({ genres: ["Ecchi"] })).toBe(true);
    expect(detectAdultContent({ genres: ["Pornography"] })).toBe(true);
    expect(detectAdultContent({ title: "Amateur Porn Special" })).toBe(true);
    expect(detectAdultContent({ rating: "Rx - Hentai" })).toBe(true);
  });
});
