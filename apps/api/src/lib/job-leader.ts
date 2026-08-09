import { randomBytes } from "node:crypto";
import { getRedis } from "./redis";

const LEADER_KEY = "jobs:leader:v1";
const LEADER_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

const instanceId = `${process.pid}-${randomBytes(6).toString("hex")}`;

let renewTimer: ReturnType<typeof setInterval> | null = null;
let isLeader = false;

/**
 * Redis single-leader lock so only one API replica runs interval jobs
 * (views flush, catalog sync, media cleanup, episode notifications).
 */
export async function tryBecomeJobLeader(): Promise<boolean> {
  const redis = getRedis();
  try {
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }

    const acquired = await redis.set(LEADER_KEY, instanceId, "PX", LEADER_TTL_MS, "NX");
    if (acquired === "OK") {
      isLeader = true;
      return true;
    }

    const current = await redis.get(LEADER_KEY);
    if (current === instanceId) {
      await redis.pexpire(LEADER_KEY, LEADER_TTL_MS);
      isLeader = true;
      return true;
    }

    isLeader = false;
    return false;
  } catch {
    // Redis is required for distributed leadership, but a transient outage must
    // not become an unhandled rejection that terminates the HTTP process.
    isLeader = false;
    return false;
  }
}

export function isJobLeader(): boolean {
  return isLeader;
}

export function startJobLeaderRenewal(): void {
  if (renewTimer) return;
  renewTimer = setInterval(() => {
    void tryBecomeJobLeader().catch(() => {
      isLeader = false;
    });
  }, RENEW_INTERVAL_MS);
  renewTimer.unref?.();
}

export function stopJobLeaderRenewal(): void {
  if (renewTimer) {
    clearInterval(renewTimer);
    renewTimer = null;
  }
}

export function getJobLeaderInstanceId(): string {
  return instanceId;
}
