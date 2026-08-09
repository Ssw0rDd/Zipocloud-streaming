import { createHash } from "node:crypto";
import type Redis from "ioredis";
import { getRedis } from "../lib/redis";
import { protectedStreamTokenHash } from "./token";

const SESSION_PREFIX = "protected:stream:session:v1:";
const INIT_PREFIX = "protected:stream:init:v1:";
const INIT_WINDOW_MS = 60_000;

export interface ProtectedStreamState {
  userId: string;
  videoId: string;
  expiresAt: number;
  nextSegment: number;
  totalSegments: number;
}

export type SegmentClaimResult = "ok" | "expired" | "missing" | "out-of-order" | "complete";

export interface ProtectedStreamStore {
  acquireInitLimit(userId: string, videoId: string): Promise<boolean>;
  createSession(token: string, state: ProtectedStreamState): Promise<void>;
  readSession(token: string): Promise<ProtectedStreamState | null>;
  claimSegment(token: string, segmentIndex: number, now: number): Promise<SegmentClaimResult>;
}

function initKey(userId: string, videoId: string): string {
  const digest = createHash("sha256").update(userId).update("\0").update(videoId).digest("hex");
  return `${INIT_PREFIX}${digest}`;
}

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${protectedStreamTokenHash(token)}`;
}

const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local value = cjson.decode(raw)
local now = tonumber(ARGV[2])
if tonumber(value.expiresAt) <= now then
  redis.call('DEL', KEYS[1])
  return -2
end
local requested = tonumber(ARGV[1])
local expected = tonumber(value.nextSegment)
if expected >= tonumber(value.totalSegments) then return -4 end
if requested ~= expected then return -3 end
value.nextSegment = expected + 1
local ttl = tonumber(value.expiresAt) - now
redis.call('SET', KEYS[1], cjson.encode(value), 'PX', ttl, 'XX')
return 1
`;

async function readyRedis(client: Redis): Promise<Redis> {
  if (client.status === "wait" || client.status === "end") await client.connect();
  if (client.status !== "ready") await client.ping();
  return client;
}

export class RedisProtectedStreamStore implements ProtectedStreamStore {
  constructor(private readonly redis: Redis = getRedis()) {}

  async acquireInitLimit(userId: string, videoId: string): Promise<boolean> {
    const client = await readyRedis(this.redis);
    return await client.set(initKey(userId, videoId), "1", "PX", INIT_WINDOW_MS, "NX") === "OK";
  }

  async createSession(token: string, state: ProtectedStreamState): Promise<void> {
    const ttl = state.expiresAt - Date.now();
    if (ttl <= 0) throw new Error("Cannot store an expired protected stream session");
    const client = await readyRedis(this.redis);
    const stored = await client.set(sessionKey(token), JSON.stringify(state), "PX", ttl, "NX");
    if (stored !== "OK") throw new Error("Protected stream token collision");
  }

  async readSession(token: string): Promise<ProtectedStreamState | null> {
    const client = await readyRedis(this.redis);
    const raw = await client.get(sessionKey(token));
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as ProtectedStreamState;
      return state.expiresAt > Date.now() ? state : null;
    } catch {
      return null;
    }
  }

  async claimSegment(token: string, segmentIndex: number, now: number): Promise<SegmentClaimResult> {
    const client = await readyRedis(this.redis);
    const code = Number(await client.eval(CLAIM_SCRIPT, 1, sessionKey(token), segmentIndex, now));
    return code === 1 ? "ok"
      : code === -2 ? "expired"
      : code === -3 ? "out-of-order"
      : code === -4 ? "complete"
      : "missing";
  }
}

/** Deterministic test/development store; production routes use Redis and fail closed. */
export class MemoryProtectedStreamStore implements ProtectedStreamStore {
  private readonly sessions = new Map<string, ProtectedStreamState>();
  private readonly initLimits = new Map<string, number>();

  async acquireInitLimit(userId: string, videoId: string): Promise<boolean> {
    const key = initKey(userId, videoId);
    const now = Date.now();
    const expiresAt = this.initLimits.get(key) ?? 0;
    if (expiresAt > now) return false;
    this.initLimits.set(key, now + INIT_WINDOW_MS);
    return true;
  }

  async createSession(token: string, state: ProtectedStreamState): Promise<void> {
    const key = sessionKey(token);
    if (this.sessions.has(key)) throw new Error("Protected stream token collision");
    this.sessions.set(key, { ...state });
  }

  async readSession(token: string): Promise<ProtectedStreamState | null> {
    const state = this.sessions.get(sessionKey(token));
    return state && state.expiresAt > Date.now() ? { ...state } : null;
  }

  async claimSegment(token: string, segmentIndex: number, now: number): Promise<SegmentClaimResult> {
    const key = sessionKey(token);
    const state = this.sessions.get(key);
    if (!state) return "missing";
    if (state.expiresAt <= now) {
      this.sessions.delete(key);
      return "expired";
    }
    if (state.nextSegment >= state.totalSegments) return "complete";
    if (segmentIndex !== state.nextSegment) return "out-of-order";
    state.nextSegment += 1;
    return "ok";
  }
}
