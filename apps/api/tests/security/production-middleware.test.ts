import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { compressPlugin } from "../../src/plugins/compress";
import { securityHeaders } from "../../src/plugins/security-headers";

describe("production middleware scope", () => {
  it("applies security headers to routes registered after the plugin", async () => {
    const app = new Elysia()
      .use(securityHeaders)
      .get("/after", () => ({ ok: true }));

    const response = await app.handle(new Request("http://localhost/after"));

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("applies compression to routes registered after the plugin", async () => {
    const app = new Elysia()
      .use(compressPlugin)
      .get("/after", () => ({ value: "x".repeat(4_096) }));

    const response = await app.handle(new Request("http://localhost/after", {
      headers: { "Accept-Encoding": "gzip" },
    }));

    expect(response.headers.get("content-encoding")).toBe("gzip");
  });
});
