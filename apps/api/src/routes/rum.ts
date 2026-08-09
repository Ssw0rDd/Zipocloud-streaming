import { Elysia, t } from "elysia";

const ALLOWED_METRICS = new Set(["cls", "fcp", "fid", "inp", "lcp", "ttfb"]);

export function normalizeRumPath(rawPath: string): string | null {
  if (!rawPath.startsWith("/") || rawPath.length > 512 || /[\u0000-\u001f\u007f]/.test(rawPath)) {
    return null;
  }
  const segments = rawPath.split("/").filter(Boolean).slice(0, 8);
  if (["pt", "en", "es", "fr", "de", "it", "ja", "ko", "zh"].includes(segments[0] ?? "")) {
    segments[0] = ":locale";
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (["movie", "series", "anime", "person", "clip", "cinema"].includes(segments[index]!)) {
      segments[index + 1] = segments[index] === "clip" || segments[index] === "cinema"
        ? ":token"
        : ":id";
    }
    if (segments[index] === "playlists") segments[index + 1] = ":id";
  }
  return `/${segments.join("/")}`;
}

/**
 * Best-effort RUM intake. No persistence of PII; accepts beacon payloads and returns 204.
 * Safe to drop under load — clients use sendBeacon.
 */
export const rumRoutes = new Elysia({ prefix: "/api/v1" }).post(
  "/rum",
  ({ body, set }) => {
    const route = normalizeRumPath(body.path);
    const entries = Object.entries(body.metrics ?? {}).filter(([name, value]) =>
      ALLOWED_METRICS.has(name) && Number.isFinite(value) && value >= 0 && value <= 120_000
    );
    if (!route || entries.length < 1 || entries.length > 3) {
      set.status = 400;
      return { error: "Invalid rum payload", code: "VALIDATION_ERROR" };
    }
    for (const [metric, value] of entries) {
      console.info(JSON.stringify({
        event: "web_vital",
        route,
        metric,
        value: Number(value.toFixed(metric === "cls" ? 4 : 1)),
        timestamp: body.ts ?? Date.now(),
      }));
    }
    set.status = 204;
    return;
  },
  {
    body: t.Object({
      path: t.String({ maxLength: 512 }),
      metrics: t.Record(t.String({ maxLength: 16 }), t.Number()),
      ts: t.Optional(t.Number()),
    }),
  },
);
