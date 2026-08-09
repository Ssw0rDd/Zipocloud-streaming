export interface PlaybackPrefs {
  preferredProvider?: string;
  audioLang?: string;
  subtitleLang?: string;
  anime4k?: boolean;
}

const STORAGE_KEY = "zipo-playback-prefs";

export function readPlaybackPrefs(): PlaybackPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PlaybackPrefs) : {};
  } catch {
    return {};
  }
}

export function writePlaybackPrefs(patch: Partial<PlaybackPrefs>): PlaybackPrefs {
  const next = { ...readPlaybackPrefs(), ...patch };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function isAnime4KFeatureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ANIME4K_ENABLED === "true";
}
