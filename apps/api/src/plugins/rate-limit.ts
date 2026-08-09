import { Elysia } from "elysia";
import { config } from "../config";
import { resolveClientIp } from "../lib/client-ip";
import { incrementRateLimit } from "../lib/redis";

export interface RateLimitConfig {
  max: number;
  windowMs: number;
  keyPrefix?: string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, WindowEntry>>();
export const MEMORY_RATE_LIMIT_MAX_KEYS = 10_000;

/** Tighter quotas for hot paths (per IP). */
const PLAYBACK_ROUTE_LIMITS: Array<{
  match: (method: string, pathname: string) => boolean;
  max: number;
  windowMs: number;
  keyPrefix: string;
}> = [
  {
    match: (method, pathname) =>
      method === "POST" && pathname === "/api/v1/donate/pix",
    max: 5,
    windowMs: 60_000,
    keyPrefix: "payments:create",
  },
  {
    match: (method, pathname) =>
      method === "POST" && pathname === "/api/v1/donate/webhooks/mercado-pago",
    max: 120,
    windowMs: 60_000,
    keyPrefix: "payments:webhook",
  },
  {
    match: (method, pathname) =>
      method === "POST" &&
      (pathname === "/api/v2/playback/sessions" ||
        pathname === "/api/v1/playback/sessions"),
    max: 30,
    windowMs: 60_000,
    keyPrefix: "playback:sessions",
  },
  {
    match: (_method, pathname) =>
      pathname.includes("/playback/preparations/") &&
      pathname.endsWith(".m3u8"),
    max: 120,
    windowMs: 60_000,
    keyPrefix: "playback:manifest",
  },
  {
    match: (method, pathname) =>
      method === "POST" &&
      (pathname === "/api/v1/clips" || pathname.startsWith("/api/v1/clips/")),
    max: 8,
    windowMs: 60_000,
    keyPrefix: "playback:clips",
  },
  // Cinema WS tickets are one-shot and refreshed on reconnect — do not share
  // the global limit with HLS segment traffic (same browsing IP burns 100/min).
  {
    match: (method, pathname) =>
      method === "POST" &&
      /^\/api\/v1\/cinema\/rooms\/[^/]+\/tickets$/.test(pathname),
    max: 40,
    windowMs: 60_000,
    keyPrefix: "cinema:tickets",
  },
];

function shouldSkipRateLimit(method: string, pathname: string): boolean {
  if (pathname === "/health" || pathname.startsWith("/health/")) return true;
  // WebSocket upgrades and long-lived cinema sockets.
  if (pathname === "/api/v1/cinema/ws" || pathname.startsWith("/api/v1/cinema/ws")) {
    return true;
  }
  // MegaFrix/native media traffic is high-frequency by design.
  if (
    pathname.includes("/playback/media/") ||
    (pathname.includes("/playback/sessions/") && pathname.includes("/stream/"))
  ) {
    return true;
  }
  return false;
}

function getStore(prefix: string): Map<string, WindowEntry> {
  let store = stores.get(prefix);
  if (!store) {
    store = new Map();
    stores.set(prefix, store);
  }
  return store;
}

export function resetRateLimitStores(): void {
  stores.clear();
}

function getWindowEntry(
  store: Map<string, WindowEntry>,
  key: string,
  windowMs: number,
  now: number,
): WindowEntry {
  const current = store.get(key);
  if (current && now < current.resetAt) return current;
  if (current) store.delete(key);

  if (store.size >= MEMORY_RATE_LIMIT_MAX_KEYS) {
    for (const [candidate, entry] of store) {
      if (now >= entry.resetAt) store.delete(candidate);
    }
  }
  while (store.size >= MEMORY_RATE_LIMIT_MAX_KEYS) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) break;
    store.delete(oldest);
  }

  const entry = { count: 0, resetAt: now + windowMs };
  store.set(key, entry);
  return entry;
}

/** In-memory fallback when Redis is unavailable (auth endpoints). */
export function checkMemoryRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; count: number } {
  const prefix = config.keyPrefix ?? "global";
  const store = getStore(prefix);
  const now = Date.now();
  const entry = getWindowEntry(store, key, config.windowMs, now);

  entry.count += 1;
  return { allowed: entry.count <= config.max, count: entry.count };
}

export function createRateLimitPlugin(config: RateLimitConfig) {
  const prefix = config.keyPrefix ?? "global";
  const store = getStore(prefix);

  return new Elysia({ name: `rate-limit-${prefix}` }).onBeforeHandle(
    { as: "global" },
    ({ request, set, server }) => {
      const key = resolveClientIp(
        request,
        server?.requestIP(request)?.address,
        false,
      );
      const now = Date.now();
      const entry = getWindowEntry(store, key, config.windowMs, now);

      entry.count += 1;

      set.headers["X-RateLimit-Limit"] = String(config.max);
      set.headers["X-RateLimit-Remaining"] = String(
        Math.max(0, config.max - entry.count),
      );
      set.headers["X-RateLimit-Reset"] = String(Math.ceil(entry.resetAt / 1000));

      if (entry.count > config.max) {
        set.status = 429;
        return {
          error: "Too Many Requests",
          message: `Rate limit exceeded: ${config.max} requests per ${config.windowMs}ms`,
        };
      }
    },
  );
}

async function applyLimit(
  key: string,
  max: number,
  windowMs: number,
  set: { status?: number | string; headers: Record<string, string | number> },
): Promise<Response | Record<string, unknown> | undefined> {
  try {
    const { count, ttl } = await incrementRateLimit(key, windowMs);
    set.headers["X-RateLimit-Limit"] = String(max);
    set.headers["X-RateLimit-Remaining"] = String(Math.max(0, max - count));
    set.headers["X-RateLimit-Reset"] = String(
      Math.ceil(Date.now() / 1000) + Math.ceil(ttl / 1000),
    );
    if (count > max) {
      set.status = 429;
      return {
        error: "Too many requests",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
      };
    }
  } catch {
    const { allowed } = checkMemoryRateLimit(key, {
      max,
      windowMs,
      keyPrefix: "ratelimit-redis-fallback",
    });
    if (!allowed) {
      set.status = 429;
      return { error: "Too many requests", code: "RATE_LIMIT_EXCEEDED" };
    }
  }
}

/** Redis-backed rate limit for production */
export const rateLimitPlugin = new Elysia({ name: "rate-limit-redis" }).onBeforeHandle(
  { as: "global" },
  async ({ request, set, server }) => {
    const url = new URL(request.url);
    if (shouldSkipRateLimit(request.method, url.pathname)) return;

    const ip = resolveClientIp(
      request,
      server?.requestIP(request)?.address,
      config.trustProxyHeaders,
    );

    for (const route of PLAYBACK_ROUTE_LIMITS) {
      if (!route.match(request.method, url.pathname)) continue;
      // Dedicated buckets: apply route limit and skip the global counter.
      return applyLimit(
        `ratelimit:${route.keyPrefix}:${ip}`,
        route.max,
        route.windowMs,
        set,
      );
    }

    const key = `ratelimit:global:${ip}`;
    return applyLimit(key, config.rateLimitMax, config.rateLimitWindowMs, set);
  },
);
