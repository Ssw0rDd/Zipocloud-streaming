import type { EnrichedContent, EpisodeInfo, SeasonInfo } from "@zipo/shared";
import type { ContentDetail, ContentType } from "./api";
import { apiFetch, fetchContentById } from "./api";

const V1 = "/api/v1";

export interface WebEnrichedEpisode {
  id: string;
  number: number;
  season?: number;
  title: string;
  description?: string;
  duration?: number;
  still?: string;
  stillCandidates?: string[];
  airDate?: string;
}

export interface WebEnrichedSeason {
  number: number;
  name?: string;
  episodeCount?: number;
  poster?: string;
  episodes: WebEnrichedEpisode[];
}

export interface WebEnrichedContent extends ContentDetail {
  status?: string;
  runtime?: number;
  trailer?: string;
  sources?: EnrichedContent["sources"];
  characters?: EnrichedContent["characters"];
  relations?: EnrichedContent["relations"];
  recommendations?: EnrichedContent["recommendations"];
  scores?: EnrichedContent["scores"];
  production?: EnrichedContent["production"];
  seasons?: WebEnrichedSeason[];
  enrichedEpisodes?: WebEnrichedEpisode[];
  castCredits?: EnrichedContent["castCredits"];
}

function mapEpisode(ep: EpisodeInfo): WebEnrichedEpisode {
  return {
    id: ep.id,
    number: ep.number,
    season: ep.season,
    title: ep.title,
    description: ep.description,
    duration: ep.runtime,
    still: ep.still,
    stillCandidates: ep.stillCandidates,
    airDate: ep.airDate ?? ep.aired,
  };
}

function mapSeason(season: SeasonInfo): WebEnrichedSeason {
  return {
    number: season.number,
    name: season.name,
    episodeCount: season.episodeCount ?? season.episodes?.length,
    poster: season.poster,
    episodes: (season.episodes ?? []).map(mapEpisode),
  };
}

function mapEnrichedContent(
  raw: EnrichedContent,
  type: ContentType,
): WebEnrichedContent {
  const director = raw.director;
  const directorStr = Array.isArray(director)
    ? director.join(", ")
    : typeof director === "string"
      ? director
      : undefined;

  const seasons = raw.seasons?.map(mapSeason);
  const enrichedEpisodes =
    seasons && seasons.length > 0
      ? seasons.flatMap((s) => s.episodes)
      : (raw.episodes ?? []).map(mapEpisode);

  return {
    id: raw.id,
    type,
    title: raw.title,
    originalTitle: raw.originalTitle,
    description: raw.description,
    posterUrl: raw.poster,
    backdropUrl: raw.backdrop,
    posterCandidates: raw.posterCandidates,
    stillCandidates: raw.stillCandidates,
    year: raw.year,
    rating: raw.rating,
    genres: raw.genres,
    isAdult: raw.isAdult,
    access: raw.access,
    externalIds: raw.externalIds,
    playbackAvailability: raw.playbackAvailability,
    playbackAccess: raw.playbackAccess,
    localization: raw.localization,
    episodeCount: raw.episodes?.length ?? seasons?.reduce((n, s) => n + s.episodes.length, 0),
    duration: raw.runtime,
    runtime: raw.runtime,
    status: raw.status,
    cast: raw.cast,
    director: directorStr,
    trailer: raw.trailer,
    sources: raw.sources,
    characters: raw.characters,
    relations: raw.relations,
    recommendations: raw.recommendations,
    scores: raw.scores,
    production: raw.production,
    castCredits: raw.castCredits,
    seasons,
    enrichedEpisodes,
    episodes: enrichedEpisodes.map((ep) => ({
      id: ep.id,
      number: ep.number,
      season: ep.season,
      title: ep.title,
      description: ep.description,
      duration: ep.duration,
      still: ep.still,
      stillCandidates: ep.stillCandidates,
      airDate: ep.airDate,
    })),
  };
}

async function mapLegacyDetail(
  detail: ContentDetail,
  type: ContentType,
): Promise<WebEnrichedContent> {
  const episodes = (detail.episodes ?? []).map((ep) => ({
    id: ep.id,
    number: ep.number,
    season: ep.season,
    title: ep.title,
    description: ep.description,
    duration: ep.duration,
    still: ep.still,
    airDate: ep.airDate,
  }));

  const seasonMap = new Map<number, WebEnrichedEpisode[]>();
  for (const ep of episodes) {
    const sn = ep.season ?? 1;
    const list = seasonMap.get(sn) ?? [];
    list.push(ep);
    seasonMap.set(sn, list);
  }

  const seasons =
    (type === "series" || type === "anime") && episodes.length > 0
      ? Array.from(seasonMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([number, eps]) => ({
            number,
            episodeCount: eps.length,
            episodes: eps.sort((a, b) => a.number - b.number),
          }))
      : undefined;

  return {
    ...detail,
    seasons,
    enrichedEpisodes: episodes,
    scores: detail.rating != null ? [{ provider: "IMDb", value: detail.rating }] : undefined,
  };
}

export async function fetchEnrichedContent(
  type: ContentType,
  id: string,
  locale?: string,
): Promise<WebEnrichedContent> {
  try {
    const qs = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    const raw = await apiFetch<EnrichedContent>(
      `${V1}/content/${type}/${id}/enriched${qs}`,
    );
    return mapEnrichedContent(raw, type);
  } catch {
    const basic = await fetchContentById(type, id, locale);
    if (type !== "movie") {
      try {
        const { episodes } = await apiFetch<{ episodes: ContentDetail["episodes"] }>(
          `${V1}/content/${type}/${id}/episodes`,
        );
        return mapLegacyDetail({ ...basic, episodes }, type);
      } catch {
        // fallback sem thumbnails enriquecidos
      }
    }
    return mapLegacyDetail(basic, type);
  }
}

export function youtubeEmbedUrl(trailer?: string): string | undefined {
  const id = youtubeEmbedId(trailer);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : undefined;
}

export function youtubeEmbedId(trailer?: string): string | undefined {
  if (!trailer) return undefined;
  if (trailer.includes("youtube.com/watch")) {
    try {
      const id = new URL(trailer).searchParams.get("v");
      return id ?? undefined;
    } catch {
      return undefined;
    }
  }
  if (trailer.includes("youtu.be/")) {
    const id = trailer.split("youtu.be/")[1]?.split(/[?&]/)[0];
    return id ?? undefined;
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(trailer)) {
    return trailer;
  }
  return undefined;
}

export function youtubePreviewEmbedUrl(
  trailer?: string,
  options?: { autoplay?: boolean; mute?: boolean; controls?: boolean },
): string | undefined {
  const base = youtubeEmbedUrl(trailer);
  if (!base) return undefined;
  const params = new URLSearchParams();
  if (options?.autoplay !== false) params.set("autoplay", "1");
  if (options?.mute !== false) params.set("mute", "1");
  if (options?.controls === false) params.set("controls", "0");
  params.set("rel", "0");
  params.set("modestbranding", "1");
  params.set("playsinline", "1");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export interface TrailerLookup {
  trailer?: string;
  source?: "cinemeta" | "kitsu";
}

export async function fetchTrailer(
  type: ContentType,
  id: string,
): Promise<TrailerLookup> {
  return apiFetch<TrailerLookup>(`${V1}/content/${type}/${id}/trailer`);
}
