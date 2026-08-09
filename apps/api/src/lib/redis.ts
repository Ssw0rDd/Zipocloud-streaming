import Redis from "ioredis";
import { env } from "../env";

let redis: Redis | null = null;
let lastErrorLogAt = 0;

function shouldPreferIpv4(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function attachRedisErrorHandler(client: Redis): void {
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastErrorLogAt < 30_000) return;
    lastErrorLogAt = now;
    if (env.NODE_ENV === "development") {
      console.warn(
        "[redis] indisponivel - cache/rate-limit usam fallback. Suba: docker compose up -d redis",
        err.message,
      );
    } else {
      console.warn("[redis] connection error:", err.message);
    }
  });
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      ...(shouldPreferIpv4(env.REDIS_URL) ? { family: 4 } : {}),
      retryStrategy(times) {
        if (times > 15) return null;
        return Math.min(times * 200, 5_000);
      },
    });
    attachRedisErrorHandler(redis);
  }
  return redis;
}

export async function checkRedis(): Promise<boolean> {
  try {
    const client = getRedis();
    if (client.status !== "ready") {
      await client.connect();
    }
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds = 300,
): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // cache miss on write is non-fatal
  }
}

export async function incrementRateLimit(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttl: number }> {
  const client = getRedis();
  if (client.status !== "ready") {
    await client.connect();
  }
  const count = await client.incr(key);
  if (count === 1) {
    await client.pexpire(key, windowMs);
  }
  const ttl = await client.pttl(key);
  return { count, ttl };
}