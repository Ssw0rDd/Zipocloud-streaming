import type { EpisodeInfo } from "@zipo/shared";

/** Ignora "undefined", "null", NaN e valores inválidos na query ?ep= */
export function parseWatchEpisodeParam(raw: string | null): number | undefined {
  if (!raw || raw === "undefined" || raw === "null") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

export function firstEpisodeNumber(episodes?: EpisodeInfo[]): number | undefined {
  if (!episodes?.length) return undefined;
  for (const ep of episodes) {
    if (ep.number != null && Number.isFinite(ep.number) && ep.number >= 1) {
      return ep.number;
    }
  }
  return undefined;
}

export function resolveWatchEpisodeNumber(
  raw: string | null,
  episodes?: EpisodeInfo[],
): number {
  return parseWatchEpisodeParam(raw) ?? firstEpisodeNumber(episodes) ?? 1;
}

/** Gera `?ep=N` com fallback seguro — nunca `undefined` na URL */
export function watchEpisodeQuery(
  epNumber: number | undefined | null,
  season?: number | null,
  fallback = 1,
): string {
  const n =
    epNumber != null && Number.isFinite(epNumber) && epNumber >= 1
      ? Math.floor(epNumber)
      : fallback;
  const validSeason =
    season != null && Number.isFinite(season) && season >= 1
      ? Math.floor(season)
      : undefined;
  const params = new URLSearchParams();
  if (validSeason != null) params.set("season", String(validSeason));
  params.set("ep", String(n));
  return `?${params.toString()}`;
}
