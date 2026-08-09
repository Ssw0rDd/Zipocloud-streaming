import { describe, expect, test } from "bun:test";
import { safeSameOriginRedirect } from "./index";

describe("ZiPo auth UI redirect policy", () => {
  test("allows relative and same-origin redirects", () => {
    expect(safeSameOriginRedirect("/pt/profile", "https://zipo.example"))
      .toBe("https://zipo.example/pt/profile");
  });

  test("rejects cross-origin redirects", () => {
    expect(safeSameOriginRedirect("https://evil.example/take-session", "https://zipo.example"))
      .toBeNull();
  });
});
