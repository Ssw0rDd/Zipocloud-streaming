import { cacheGet, cacheSet } from "../lib/redis";

const FAIL_TTL = 900;
const DEGRADED_THRESHOLD = 3;

function failKey(providerId: string): string {
  return `playback:health:${providerId}:fails`;
}

export async function recordProviderFailure(providerId: string): Promise<void> {
  const key = failKey(providerId);
  const current = (await cacheGet<number>(key)) ?? 0;
  await cacheSet(key, current + 1, FAIL_TTL);
}

export async function recordProviderSuccess(providerId: string): Promise<void> {
  await cacheSet(failKey(providerId), 0, FAIL_TTL);
}

export async function isProviderDegraded(providerId: string): Promise<boolean> {
  const fails = (await cacheGet<number>(failKey(providerId))) ?? 0;
  return fails >= DEGRADED_THRESHOLD;
}
