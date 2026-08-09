import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, json } from "../helpers/test-app";

describe("SEC-AD01 to SEC-AD02 — Ads security", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  test("SEC-AD01: scripts não allowlisted filtrados", async () => {
    const { status, body } = await json<{ html: string }>(
      app,
      "/ads/config?tier=free",
    );

    expect(status).toBe(200);
    expect(body.html).toContain("pagead2.googlesyndication.com");
    expect(body.html).not.toContain("evil.example.com");
    expect(body.html).not.toContain("localhost:3001");
  });

  test("SEC-AD02: impression sem PII", async () => {
    const { status, body } = await json<{ ok: boolean; stored: string[] }>(
      app,
      "/ads/impression",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adUnitId: "banner-top",
          tier: "free",
          placement: "home",
          email: "user@secret.com",
          phone: "+5511999999999",
          name: "John Doe",
          ipAddress: "203.0.113.1",
        }),
      },
    );

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.stored).not.toContain("email");
    expect(body.stored).not.toContain("phone");
    expect(body.stored).not.toContain("name");
    expect(body.stored).not.toContain("ipAddress");

    const impressions = app.store.impressions;
    const last = impressions[impressions.length - 1]!;
    expect(last).not.toHaveProperty("email");
    expect(last).not.toHaveProperty("phone");
    expect(last).not.toHaveProperty("name");
    expect(last.adUnitId).toBe("banner-top");
  });
});
