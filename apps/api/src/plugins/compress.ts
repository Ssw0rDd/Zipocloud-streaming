import { Elysia } from "elysia";

const MIN_COMPRESS_BYTES = 1024;

/**
 * Gzip-compresses JSON/text responses when the client accepts gzip.
 * Brotli is handled at the nginx reverse proxy in production.
 */
export const compressPlugin = new Elysia({ name: "compress" }).mapResponse(
  { as: "global" },
  ({ request, set, response }): Response | void => {
    const accept = request.headers.get("accept-encoding") ?? "";
    if (!accept.includes("gzip")) return;

    if (response instanceof Response) return;

    const status = typeof set.status === "number" ? set.status : 200;
    if (status < 200 || status >= 300) return;

    let body: string;
    if (typeof response === "string") {
      body = response;
    } else if (response && typeof response === "object") {
      body = JSON.stringify(response);
      if (!set.headers["content-type"]) {
        set.headers["content-type"] = "application/json; charset=utf-8";
      }
    } else {
      return;
    }

    if (Buffer.byteLength(body) < MIN_COMPRESS_BYTES) return;

    set.headers["content-encoding"] = "gzip";
    set.headers["vary"] = "Accept-Encoding";

    // CompressionStream yields while compressing large JSON responses instead
    // of blocking every request on the Bun event loop.
    const compressed = new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(compressed, {
      status,
      headers: set.headers as HeadersInit,
    });
  },
);
