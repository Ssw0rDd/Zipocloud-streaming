import type { UserTier } from "@zipo/shared";

export function resolveUserTier(
  isLoggedIn: boolean,
  isSupporter?: boolean,
): UserTier {
  if (!isLoggedIn) return "guest";
  if (isSupporter) return "supporter";
  return "member";
}

/** Generate obfuscated ad slot class name per session */
export function obfuscatedAdClass(sessionSeed: string, placement: string): string {
  const hash = simpleHash(`${sessionSeed}:${placement}`);
  return `zp_${hash.toString(36).slice(0, 8)}`;
}

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function generateSessionSeed(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const SESSION_SEED_KEY = "zipo-ad-seed";

/** Stable per-tab seed — only call inside useEffect (client). */
export function getOrCreateSessionSeed(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = sessionStorage.getItem(SESSION_SEED_KEY);
    if (existing) return existing;
    const seed = generateSessionSeed();
    sessionStorage.setItem(SESSION_SEED_KEY, seed);
    return seed;
  } catch {
    return generateSessionSeed();
  }
}
