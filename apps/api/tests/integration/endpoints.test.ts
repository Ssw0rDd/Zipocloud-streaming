import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, json, request } from "../helpers/test-app";

describe("Integration — API endpoints", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  test("GET /health returns ok", async () => {
    const { status, body } = await json<{ status: string }>(app, "/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  test("GET /search returns escaped query and items", async () => {
    const { status, body } = await json<{
      items: unknown[];
      total: number;
      query: string;
    }>(app, "/search?q=shawshank");

    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(0);
    expect(body.query).toBe("shawshank");
  });

  test("GET /content/:type/:id returns content detail", async () => {
    const { status, body } = await json<{ title: string }>(
      app,
      "/content/movie/tt0111161",
    );

    expect(status).toBe(200);
    expect(body.title).toBe("The Shawshank Redemption");
  });

  test("GET /content with invalid id returns 400", async () => {
    const { status } = await json(app, "/content/movie/invalid id!");
    expect(status).toBe(400);
  });

  test("POST /comments creates and lists comments", async () => {
    const created = await json(app, "/comments/tt0111161", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "u1",
      },
      body: JSON.stringify({ body: "Great movie!" }),
    });
    expect(created.status).toBe(201);

    const list = await json<unknown[]>(app, "/comments/tt0111161");
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });

  test("POST /clips creates retrievable clip", async () => {
    const created = await json<{ token: string }>(app, "/clips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "u1",
      },
      body: JSON.stringify({
        contentType: "movie",
        contentId: "tt0111161",
        title: "Scene",
        startSeconds: 10,
        endSeconds: 30,
      }),
    });
    expect(created.status).toBe(201);

    const fetched = await json(app, `/clips/${created.body.token}`);
    expect(fetched.status).toBe(200);
  });

  test("security headers on all integration routes", async () => {
    const routes = ["/health", "/search?q=test", "/ads/config"];

    for (const route of routes) {
      const res = await request(app, route);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    }
  });
});
