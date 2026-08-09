import { describe, test, expect, beforeEach } from "bun:test";
import type { Clip } from "@zipo/shared";
import { createTestApp, json } from "../helpers/test-app";

const validClip = {
  contentType: "movie" as const,
  contentId: "tt0111161",
  title: "Shawshank moment",
  startSeconds: 100,
  endSeconds: 200,
};

describe("SEC-CL01 to SEC-CL03 — Clips security", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  test("SEC-CL01: start >= end rejeitado, aceita 5min exatos e rejeita acima", async () => {
    const equal = await json(app, "/clips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "clip-user",
      },
      body: JSON.stringify({ ...validClip, startSeconds: 200, endSeconds: 200 }),
    });
    expect(equal.status).toBe(400);

    const reversed = await json(app, "/clips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "clip-user",
      },
      body: JSON.stringify({ ...validClip, startSeconds: 300, endSeconds: 100 }),
    });
    expect(reversed.status).toBe(400);

    const tooLong = await json(app, "/clips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "clip-user",
      },
      body: JSON.stringify({
        ...validClip,
        startSeconds: 0,
        endSeconds: 301,
      }),
    });
    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(tooLong.body)).toMatch(/5 minute/i);

    const exactLimit = await json(app, "/clips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "clip-user",
      },
      body: JSON.stringify({ ...validClip, startSeconds: 180, endSeconds: 480 }),
    });
    expect(exactLimit.status).toBe(201);
  });

  test("SEC-CL02: IDs inválidos rejeitados", async () => {
    const invalidIds = ["", "../../../etc", "<script>", "x".repeat(100)];

    for (const contentId of invalidIds) {
      const res = await json(app, "/clips", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "clip-user",
        },
        body: JSON.stringify({ ...validClip, contentId }),
      });
      expect(res.status).toBe(400);
    }

    const badToken = await json(app, "/clips/not-valid!", { method: "GET" });
    expect(badToken.status).toBe(400);
  });

  test("SEC-CL04: XSS em título de clip sanitizado", async () => {
    const xssTitle = 'Scene <script>alert(1)</script><img onerror="x" src=x>';
    const res = await json<Clip>(app, "/clips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "clip-user",
      },
      body: JSON.stringify({ ...validClip, title: xssTitle }),
    });
    expect(res.status).toBe(201);
    expect(res.body.title).not.toContain("<script>");
    expect(res.body.title).not.toMatch(/onerror\s*=/i);
    expect(res.body.title).toContain("Scene");
  });

  test("SEC-CL03: max 10 clips/dia", async () => {
    const headers = {
      "Content-Type": "application/json",
      "x-user-id": "heavy-clipper",
    };

    for (let i = 0; i < 10; i++) {
      const res = await json<Clip>(app, "/clips", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...validClip,
          startSeconds: i * 10,
          endSeconds: i * 10 + 5,
          title: `Clip ${i}`,
        }),
      });
      expect(res.status).toBe(201);
    }

    const blocked = await json(app, "/clips", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...validClip,
        startSeconds: 0,
        endSeconds: 10,
        title: "Clip 11",
      }),
    });
    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked.body)).toMatch(/10\/day/i);
  });
});
