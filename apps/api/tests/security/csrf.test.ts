import { describe, expect, test } from "bun:test";
import { csrfRejection } from "../../src/plugins/csrf";

describe("CSRF checks", () => {
  test("allows credentialless mutation without Origin (server-to-server)", () => {
    expect(
      csrfRejection("POST", "/api/v1/comments/x", null, null, {
        hasCookie: false,
        secFetchSite: null,
      }),
    ).toBeNull();
  });

  test("rejects cookie-authenticated mutation without Origin or Referer", () => {
    const rejected = csrfRejection("POST", "/api/v1/comments/x", null, null, {
      hasCookie: true,
      secFetchSite: null,
    });

    expect(rejected?.code).toBe("CSRF_REJECTED");
  });

  test("rejects browser-declared cross-site mutation", () => {
    const rejected = csrfRejection("POST", "/api/v1/comments/x", null, null, {
      hasCookie: false,
      secFetchSite: "cross-site",
    });

    expect(rejected?.code).toBe("CSRF_REJECTED");
  });

  test("allows mutating request from allowlisted Origin", () => {
    expect(
      csrfRejection("POST", "/api/v1/comments/x", "http://localhost:3000", null),
    ).toBeNull();
  });

  test("rejects mutating request from foreign Origin", () => {
    const rejected = csrfRejection(
      "POST",
      "/api/v1/comments/x",
      "https://evil.example",
      null,
    );
    expect(rejected?.code).toBe("CSRF_REJECTED");
  });

  test("rejects foreign Referer when Origin absent", () => {
    const rejected = csrfRejection(
      "POST",
      "/api/v1/comments/x",
      null,
      "https://evil.example/page",
    );
    expect(rejected?.code).toBe("CSRF_REJECTED");
  });

  test("does not block GET", () => {
    expect(
      csrfRejection("GET", "/api/v1/catalog", "https://evil.example", null),
    ).toBeNull();
  });

  test("skips Better Auth paths", () => {
    expect(
      csrfRejection("POST", "/api/auth/sign-in", "https://evil.example", null),
    ).toBeNull();
  });
});
