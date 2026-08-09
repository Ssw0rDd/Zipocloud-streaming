import { describe, expect, it } from "bun:test";
import { normalizeRumPath } from "../../src/routes/rum";

describe("RUM route normalization", () => {
  it("removes locale, content IDs and bearer-style route tokens", () => {
    expect(normalizeRumPath("/pt/movie/tt1234567")).toBe("/:locale/movie/:id");
    expect(normalizeRumPath("/en/cinema/secret-room-token")).toBe("/:locale/cinema/:token");
    expect(normalizeRumPath("/pt/profile/playlists/private-id")).toBe(
      "/:locale/profile/playlists/:id",
    );
  });

  it("rejects malformed paths", () => {
    expect(normalizeRumPath("https://evil.example/path")).toBeNull();
    expect(normalizeRumPath(`/pt/${"x".repeat(600)}`)).toBeNull();
    expect(normalizeRumPath("/pt/movie/bad\nvalue")).toBeNull();
  });
});
