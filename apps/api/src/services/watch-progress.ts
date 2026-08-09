export interface WatchProgressCandidate {
  contentType: string;
  contentId: string;
  progressSeconds: number;
  completed: boolean;
}

export function canonicalEpisodeKey(input: {
  contentType: string;
  episodeId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): string {
  if (input.contentType === "movie") return "movie";
  const episodeId = input.episodeId?.trim();
  if (episodeId) return `id:${episodeId}`;
  if (input.episodeNumber != null && input.episodeNumber > 0) {
    const season = input.seasonNumber != null && input.seasonNumber > 0
      ? input.seasonNumber
      : 1;
    return `s:${season}:e:${input.episodeNumber}`;
  }
  return "unknown";
}

export function normalizeWatchProgress(input: {
  progressSeconds: number;
  durationSeconds?: number;
  completed?: boolean;
}): {
  progressSeconds: number;
  durationSeconds?: number;
  completed: boolean;
} {
  const durationSeconds = input.durationSeconds && input.durationSeconds > 0
    ? Math.floor(input.durationSeconds)
    : undefined;
  const rawProgress = Math.max(0, Math.floor(input.progressSeconds));
  const progressSeconds = durationSeconds
    ? Math.min(rawProgress, durationSeconds)
    : rawProgress;
  return {
    progressSeconds,
    durationSeconds,
    completed: input.completed === true || Boolean(
      durationSeconds && progressSeconds >= durationSeconds * 0.95,
    ),
  };
}

/** Input must be newest-first. A latest completed/reset row suppresses older episodes. */
export function selectContinueProgress<T extends WatchProgressCandidate>(
  rows: T[],
  limit = 12,
): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const row of rows) {
    const key = `${row.contentType}:${row.contentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.completed || row.progressSeconds < 10) continue;
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}
