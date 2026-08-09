import { describe, test, expect, beforeEach } from "bun:test";
import { SECURITY_HEADERS } from "../../src/plugins/security";
import { createTestApp, json, request } from "../helpers/test-app";

describe("SEC-001 to SEC-008 — General security", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  test("SEC-001: XSS na busca — script tag não refletido raw", async () => {
    const payload = '<script>alert("xss")</script>';
    const { status, body } = await json<{ query: string }>(
      app,
      `/search?q=${encodeURIComponent(payload)}`,
    );

    expect(status).toBe(200);
    expect(body.query).not.toContain("<script>");
    expect(body.query).toContain("&lt;script&gt;");
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/<script>/i);
  });

  test("SEC-002: SSRF — rejeitar URLs em embed", async () => {
    const maliciousUrls = [
      "http://localhost/admin",
      "http://127.0.0.1:8080/internal",
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/router",
    ];

    for (const url of maliciousUrls) {
      const { status, body } = await json<{ error?: string }>(app, "/embed/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      expect(status).toBe(400);
      expect(body.error).toBeDefined();
    }

    const safe = await json(app, "/embed/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://cdn.example.com/video.mp4" }),
    });
    expect(safe.status).toBe(200);
  });

  test("SEC-003: Rate limit 101 req/min → 429", async () => {
    const limitedApp = createTestApp({ rateLimitMax: 100 });

    for (let i = 0; i < 100; i++) {
      const res = await request(limitedApp, "/health", {
        headers: { "x-forwarded-for": "10.0.0.99" },
      });
      expect(res.status).toBe(200);
    }

    const blocked = await request(limitedApp, "/health", {
      headers: { "x-forwarded-for": "10.0.0.99" },
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe("Too Many Requests");
  });

  test("SEC-004: CORS origin não allowlisted bloqueado", async () => {
    const corsApp = createTestApp({
      corsOrigins: ["http://localhost:3000"],
    });

    const blocked = await request(corsApp, "/health", {
      headers: { Origin: "https://evil.com" },
    });
    expect(blocked.status).toBe(403);

    const allowed = await request(corsApp, "/health", {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
  });

  test("SEC-005: Path traversal rejeitado", async () => {
    const paths = [
      "../../../etc/passwd",
      "..\\..\\windows\\system32",
      "foo/../../../secret",
      "/etc/passwd",
      "%2e%2e/admin",
    ];

    for (const path of paths) {
      const { status, body } = await json<{ error?: string }>(app, "/files/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      expect(status).toBe(400);
      expect(body.error).toMatch(/path traversal/i);
    }
  });

  test("SEC-006: Adult filter retorna isAdult:true", async () => {
    const { status, body } = await json<{ isAdult: boolean }>(
      app,
      "/content/anime/12345/adult-check",
    );

    expect(status).toBe(200);
    expect(body.isAdult).toBe(true);
  });

  test("SEC-007: Headers de segurança presentes", async () => {
    const res = await request(app, "/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe(
      SECURITY_HEADERS["Content-Security-Policy"],
    );
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      SECURITY_HEADERS["Strict-Transport-Security"],
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe(
      SECURITY_HEADERS["Referrer-Policy"],
    );
  });

  test("SEC-008: Input fuzz IDs inválidos → 400", async () => {
    const invalidIds = [
      "",
      "../../../etc/passwd",
      "' OR 1=1--",
      "<script>",
      "a".repeat(200),
    ];

    for (const id of invalidIds) {
      const { status } = await json(
        app,
        `/validate-id?id=${encodeURIComponent(id)}`,
      );
      expect(status).toBe(400);
    }
  });
});
