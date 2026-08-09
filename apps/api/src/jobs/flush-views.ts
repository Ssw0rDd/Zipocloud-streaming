import { db } from "../db";
import { contentViews } from "../db/schema";
import { getRedis } from "../lib/redis";
import { isJobLeader } from "../lib/job-leader";
import { config } from "../config";

const VIEWS_QUEUE_KEY = "views:queue";
const BATCH_SIZE = 100;

export async function flushViews(): Promise<number> {
  const redis = getRedis();
  if (redis.status !== "ready") {
    try {
      await redis.connect();
    } catch {
      return 0;
    }
  }

  let flushed = 0;

  for (let i = 0; i < 10; i++) {
    const raw = await redis.lpop(VIEWS_QUEUE_KEY, BATCH_SIZE);
    if (!raw || (Array.isArray(raw) && raw.length === 0)) break;

    const items = Array.isArray(raw) ? raw : [raw];
    const rows = items
      .map((item) => {
        try {
          const parsed = JSON.parse(item) as {
            contentType: string;
            contentId: string;
            episodeId?: string;
            sessionId?: string;
            userId?: string;
            durationSeconds?: number;
            progressSeconds?: number;
            viewedAt?: string;
          };
          return {
            contentType: parsed.contentType,
            contentId: parsed.contentId,
            episodeId: parsed.episodeId,
            sessionId: parsed.sessionId,
            userId: parsed.userId ?? null,
            durationSeconds: parsed.durationSeconds,
            progressSeconds: parsed.progressSeconds,
            viewedAt: parsed.viewedAt
              ? new Date(parsed.viewedAt)
              : new Date(),
          };
        } catch {
          return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      await db.insert(contentViews).values(rows);
      flushed += rows.length;
    }
  }

  return flushed;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startViewsFlushJob(): void {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    if (!isJobLeader()) return;
    try {
      const count = await flushViews();
      if (count > 0 && config.nodeEnv === "development") {
        console.log(`[views-flush] flushed ${count} views`);
      }
    } catch (err) {
      console.error("[views-flush] error:", err);
    }
  }, config.viewsFlushIntervalMs);
}

export function stopViewsFlushJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
