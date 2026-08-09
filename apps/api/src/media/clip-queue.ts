import { getRedis } from "../lib/redis";

export const CLIP_QUEUE_KEY = "media:clip:queue:v1";

/** Global backpressure: reject enqueue when queue is this deep. */
export const CLIP_QUEUE_MAX_DEPTH = Number(process.env.CLIP_QUEUE_MAX_DEPTH ?? 200);

/**
 * Max concurrent clip jobs (queued + processing slots) per user.
 * Kept high enough for cinema/watch usage; daily/burst rate limits still apply.
 */
export const MAX_CLIP_ACTIVE_PER_USER = Math.max(
  1,
  Number(process.env.CLIP_MAX_ACTIVE_PER_USER ?? 10),
);

/** Slot key TTL (seconds). Long enough for encode queue + ffmpeg; self-heals leaked counters. */
const CLIP_SLOT_TTL_SECONDS = Math.max(
  300,
  Number(process.env.CLIP_SLOT_TTL_SECONDS ?? 3_600),
);

const ACQUIRE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

const RELEASE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then redis.call('DEL', KEYS[1]); return 0 end
return redis.call('DECR', KEYS[1])
`;

function activeKey(userId: string) {
  return `media:clip:active:${userId}`;
}

export async function acquireClipSlot(userId: string): Promise<boolean> {
  const result = await getRedis().eval(
    ACQUIRE_SCRIPT,
    1,
    activeKey(userId),
    MAX_CLIP_ACTIVE_PER_USER,
    CLIP_SLOT_TTL_SECONDS,
  );
  return Number(result) === 1;
}

export async function releaseClipSlot(userId: string): Promise<void> {
  await getRedis().eval(RELEASE_SCRIPT, 1, activeKey(userId)).catch(() => undefined);
}

export async function getClipQueueDepth(): Promise<number> {
  return getRedis().llen(CLIP_QUEUE_KEY).catch(() => 0);
}

export class QueueBackpressureError extends Error {
  readonly code = "QUEUE_BACKPRESSURE" as const;
  readonly retryAfterSeconds: number;

  constructor(depth: number, maxDepth: number, retryAfterSeconds = 15) {
    super(`Media queue is full (${depth}/${maxDepth})`);
    this.name = "QueueBackpressureError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function enqueueClipJob(jobId: string): Promise<void> {
  const redis = getRedis();
  const depth = await redis.llen(CLIP_QUEUE_KEY);
  if (depth >= CLIP_QUEUE_MAX_DEPTH) {
    throw new QueueBackpressureError(depth, CLIP_QUEUE_MAX_DEPTH);
  }
  await redis.rpush(CLIP_QUEUE_KEY, jobId);
}

export async function publishClipProgress(jobId: string, payload: unknown): Promise<void> {
  await getRedis().publish(`media:clip:progress:${jobId}`, JSON.stringify(payload));
}
