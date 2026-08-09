import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createProductionCorsPlugin } from "../../src/plugins/cors";

describe("production CORS contract", () => {
  test("allows PATCH and the public browser client headers", async () => {
    const origin = "https://app.example.com";
    const app = new Elysia()
      .use(createProductionCorsPlugin([origin]))
      .patch("/resource", () => ({ ok: true }));

    const response = await app.handle(
      new Request("https://api.example.com/resource", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PATCH",
          "Access-Control-Request-Headers": [
            "content-type",
            "idempotency-key",
            "x-playback-session-token",
            "x-zipo-profile-id",
            "x-zipo-site",
          ].join(", "),
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");

    const allowedHeaders = response.headers
      .get("Access-Control-Allow-Headers")
      ?.toLowerCase();
    expect(allowedHeaders).toContain("idempotency-key");
    expect(allowedHeaders).toContain("x-playback-session-token");
    expect(allowedHeaders).toContain("x-zipo-profile-id");
  });
});
