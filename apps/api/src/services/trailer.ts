import type { ContentType } from "@zipo/shared";
import { assertValidId } from "./content";
import { getCinemetaMeta } from "./cinemeta";
import { getKitsuByMalId } from "./kitsu";
import { CACHE_TTL } from "../lib/cache-ttl";
import { cacheGet, cacheSet } from "../lib/redis";

export type TrailerSource = "cinemeta" | "kitsu";

export interface TrailerResponse {
  trailer?: string;
  source?: TrailerSource;
}

interface CinemetaTrailerMeta {
  trailers?: Array<{ source?: string; type?: string }>;
  trailerStreams?: Array<{ ytId?: string; source?: string }>;
}

export function extractCinemetaTrailer(meta: CinemetaTrailerMeta): string | undefined {
  for (const stream of meta.trailerStreams ?? []) {
    const id = stream.ytId ?? stream.source;
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return `https://www.youtube.com/watch?v=${id}`;
    }
  }

  const trailers = meta.trailers ?? [];
  const preferred =
    trailers.find((t) => t.type === "Trailer") ??
    trailers.find((t) => t.source) ??
    trailers[0];
  if (preferred?.source) {
    return `https://www.youtube.com/watch?v=${preferred.source}`;
  }

  return undefined;
}

export async function fetchTrailer(
  type: ContentType,
  id: string,
): Promise<TrailerResponse> {
  assertValidId(type, id);

  const cacheKey = `trailer:${type}:${id}`;
  const cached = await cacheGet<TrailerResponse>(cacheKey);
  if (cached) return cached;

  let result: TrailerResponse = {};

  if (type === "anime") {
    try {
      const kitsu = await getKitsuByMalId(Number(id));
      const ytId = kitsu?.attributes?.youtubeVideoId;
      if (ytId) {
        result = {
          trailer: `https://www.youtube.com/watch?v=${ytId}`,
          source: "kitsu",
        };
      }
    } catch {
      /* optional Kitsu lookup */
    }
  } else if (type === "movie" || type === "series") {
    try {
      const meta = await getCinemetaMeta(type, id);
      const trailer = extractCinemetaTrailer(meta);
      if (trailer) {
        result = { trailer, source: "cinemeta" };
      }
    } catch {
      /* optional Cinemeta lookup */
    }
  }

  await cacheSet(cacheKey, result, CACHE_TTL.CONTENT);
  return result;
}
