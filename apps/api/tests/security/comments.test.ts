import { describe, test, expect, beforeEach } from "bun:test";
import type { Comment } from "@zipo/shared";
import { createTestApp, json } from "../helpers/test-app";

describe("SEC-C01 to SEC-C03 — Comments security", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  test("SEC-C01: XSS em comentário sanitizado", async () => {
    const xssBody =
      'Hello <script>document.cookie</script><img onerror="alert(1)" src=x>';

    const { status, body } = await json<Comment>(app, "/comments/tt0111161", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "user-1",
        "x-user-name": "Alice",
      },
      body: JSON.stringify({ body: xssBody }),
    });

    expect(status).toBe(201);
    expect(body.body).not.toContain("<script>");
    expect(body.body).not.toMatch(/onerror\s*=/i);
    expect(body.body).toContain("Hello");
  });

  test("SEC-C02: IDOR delete comentário de outro user → 403", async () => {
    const created = await json<Comment>(app, "/comments/tt0111161", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "owner-user",
        "x-user-name": "Owner",
      },
      body: JSON.stringify({ body: "My comment" }),
    });

    expect(created.status).toBe(201);

    const forbidden = await json<{ error: string }>(
      app,
      `/comments/${created.body.id}`,
      {
        method: "DELETE",
        headers: { "x-user-id": "attacker-user" },
      },
    );

    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toMatch(/forbidden/i);
  });

  test("SEC-C03: Rate limit 5 comentários/min", async () => {
    const limitedApp = createTestApp({ commentRateLimitMax: 5 });
    const headers = {
      "Content-Type": "application/json",
      "x-user-id": "commenter",
      "x-forwarded-for": "10.0.0.50",
    };

    for (let i = 0; i < 5; i++) {
      const res = await json(limitedApp, "/comments/tt0111161", {
        method: "POST",
        headers,
        body: JSON.stringify({ body: `Comment ${i}` }),
      });
      expect(res.status).toBe(201);
    }

    const blocked = await json(limitedApp, "/comments/tt0111161", {
      method: "POST",
      headers,
      body: JSON.stringify({ body: "One too many" }),
    });
    expect(blocked.status).toBe(429);
  });
});
