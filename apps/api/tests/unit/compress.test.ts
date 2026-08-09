import { describe, expect, it } from "bun:test";
import { gunzipSync } from "node:zlib";
import { Elysia } from "elysia";
import { compressPlugin } from "../../src/plugins/compress";

describe("response compression", () => {
  it("streams valid gzip for large JSON responses", async () => {
    const app = new Elysia()
      .use(compressPlugin)
      .get("/large", () => ({ value: "x".repeat(4_096) }));
    const response = await app.handle(new Request("http://localhost/large", {
      headers: { "Accept-Encoding": "gzip" },
    }));

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    const decoded = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
    expect(JSON.parse(decoded)).toEqual({ value: "x".repeat(4_096) });
  });

  it("does not compress small payloads", async () => {
    const app = new Elysia().use(compressPlugin).get("/small", () => ({ ok: true }));
    const response = await app.handle(new Request("http://localhost/small", {
      headers: { "Accept-Encoding": "gzip" },
    }));
    expect(response.headers.get("content-encoding")).toBeNull();
  });
});
