import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { config } from "../config";

export interface CorsConfig {
  origins: string[];
}

export const CORS_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export const CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Idempotency-Key",
  "If-None-Match",
  "Range",
  "X-Playback-Session-Token",
  "X-Client-Public-Key",
  "X-Session-Id",
  "X-ZiPo-Include-Adult",
  "X-ZiPo-Profile-Id",
  "X-ZiPo-Site",
] as const;

const TEST_ONLY_HEADERS = ["X-User-Id", "X-User-Name"] as const;

export function createCorsPlugin(corsConfig: CorsConfig) {
  const allowed = new Set(corsConfig.origins);

  return new Elysia({ name: "cors" })
    .onBeforeHandle({ as: "global" }, ({ request, set }) => {
      const origin = request.headers.get("origin");

      if (request.method === "OPTIONS") {
        if (origin && allowed.has(origin)) {
          set.headers["Access-Control-Allow-Origin"] = origin;
          set.headers["Access-Control-Allow-Methods"] =
            CORS_METHODS.join(", ");
          set.headers["Access-Control-Allow-Headers"] =
            [...CORS_ALLOWED_HEADERS, ...TEST_ONLY_HEADERS].join(", ");
          set.headers["Access-Control-Max-Age"] = "86400";
          set.status = 204;
          return "";
        }
        set.status = 403;
        return { error: "CORS origin not allowed" };
      }

      if (origin) {
        if (!allowed.has(origin)) {
          set.status = 403;
          return { error: "CORS origin not allowed" };
        }
        set.headers["Access-Control-Allow-Origin"] = origin;
        set.headers["Vary"] = "Origin";
      }
    });
}

/** Production CORS via @elysiajs/cors */
export function createProductionCorsPlugin(origins: string[]) {
  return cors({
    origin: origins,
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    credentials: true,
    maxAge: 86400,
  });
}

export const corsPlugin = createProductionCorsPlugin(config.corsOrigins);
