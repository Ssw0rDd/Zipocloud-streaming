import { describe, expect, test } from "bun:test";
import {
  resolveBetterAuthOrigin,
  resolveMainPublicOrigin,
  validatePublicOrigin,
  validateRedisUrl,
} from "../../src/env";

describe("public origin configuration", () => {
  test("requires HTTPS for public production origins", () => {
    expect(() =>
      validatePublicOrigin("FRONTEND_URL", "http://app.example.com", "production"),
    ).toThrow();
    expect(
      validatePublicOrigin("FRONTEND_URL", "https://app.example.com/", "production"),
    ).toBe("https://app.example.com");
  });

  test("accepts localhost HTTP only outside production", () => {
    expect(
      validatePublicOrigin("FRONTEND_URL", "http://localhost:3000", "development"),
    ).toBe("http://localhost:3000");
  });

  test("rejects credentials, paths, query strings, and fragments", () => {
    for (const value of [
      "https://user:secret@app.example.com",
      "https://app.example.com/path",
      "https://app.example.com?debug=true",
      "https://app.example.com#fragment",
    ]) {
      expect(() => validatePublicOrigin("CORS_ORIGINS", value, "production")).toThrow();
    }
  });

  test("TUNNEL_URL overrides FRONTEND_URL for the main public origin", () => {
    expect(
      resolveMainPublicOrigin({
        TUNNEL_URL: "https://abc.trycloudflare.com/",
        FRONTEND_URL: "http://localhost:3000",
      }),
    ).toBe("https://abc.trycloudflare.com");
    expect(
      resolveMainPublicOrigin({
        FRONTEND_URL: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
    expect(resolveMainPublicOrigin({})).toBe("http://localhost:3000");
  });

  test("Better Auth origin follows TUNNEL_URL then BETTER_AUTH_URL without /api", () => {
    expect(
      resolveBetterAuthOrigin({
        TUNNEL_URL: "https://abc.trycloudflare.com",
        BETTER_AUTH_URL: "http://localhost:3000",
        FRONTEND_URL: "http://localhost:3000",
      }),
    ).toBe("https://abc.trycloudflare.com");
    expect(
      resolveBetterAuthOrigin({
        BETTER_AUTH_URL: "http://localhost:3000/api",
        FRONTEND_URL: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
    expect(
      resolveBetterAuthOrigin({
        FRONTEND_URL: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
  });
});

describe("production Redis configuration", () => {
  test("requires strong credentials for the internal compose service", () => {
    expect(() => validateRedisUrl("redis://redis:6379", "production")).toThrow();
    expect(validateRedisUrl(`redis://:${"r".repeat(32)}@redis:6379`, "production"))
      .toContain("redis:6379");
  });

  test("requires TLS for external production Redis", () => {
    expect(() => validateRedisUrl(`redis://:${"r".repeat(32)}@cache.example.com:6379`, "production"))
      .toThrow();
    expect(validateRedisUrl(`rediss://:${"r".repeat(32)}@cache.example.com:6380`, "production"))
      .toContain("rediss://");
  });
});
