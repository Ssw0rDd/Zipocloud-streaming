import type { MappedContentBase } from "../lib/content-mapper";

const KITSU_BASE = "https://kitsu.io/api/edge";

interface KitsuAnimeAttributes {
  canonicalTitle?: string;
  titles?: { en?: string; en_jp?: string; ja_jp?: string };
  synopsis?: string;
  posterImage?: { small?: string; medium?: string; large?: string; original?: string };
  coverImage?: { small?: string; large?: string; original?: string };
  episodeCount?: number;
  episodeLength?: number;
  status?: string;
  startDate?: string;
  youtubeVideoId?: string;
  averageRating?: string;
  ageRating?: string;
}

interface KitsuAnime {
  id: string;
  type: string;
  attributes: KitsuAnimeAttributes;
}

interface KitsuEpisodeAttributes {
  number?: number;
  seasonNumber?: number;
  titles?: { canonical?: string; en?: string; en_jp?: string };
  synopsis?: string;
  airdate?: string;
  length?: number;
  thumbnail?: { original?: string; large?: string; medium?: string; small?: string };
}

interface KitsuEpisode {
  id: string;
  type: string;
  attributes: KitsuEpisodeAttributes;
}

interface KitsuMapping {
  id: string;
  type: string;
  attributes: {
    externalSite?: string;
    externalId?: string;
  };
}

interface KitsuResponse<T> {
  data: T;
  included?: KitsuMapping[];
}

interface KitsuListResponse<T> {
  data: T[];
  included?: Array<KitsuMapping | KitsuAnime>;
}

async function fetchKitsu<T>(path: string): Promise<T> {
  const res = await fetch(`${KITSU_BASE}${path}`, {
    headers: { Accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Kitsu error: ${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function searchKitsu(query: string, limit = 20) {
  const data = await fetchKitsu<KitsuListResponse<KitsuAnime>>(
    `/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=${limit}`,
  );
  return data.data;
}

export async function searchKitsuMalItems(query: string, limit = 20) {
  let results: KitsuAnime[];
  try {
    results = await searchKitsu(query, limit);
  } catch {
    return [];
  }

  const settled = await Promise.allSettled(
    results.map(async (anime) => {
      const mappings = await getKitsuMappings(anime.id);
      const malMapping = mappings.find(
        (m) =>
          m.attributes.externalSite === "myanimelist/anime" &&
          m.attributes.externalId,
      );
      if (!malMapping?.attributes.externalId) return null;
      const base = mapKitsuToItem(anime);
      const malId = Number(malMapping.attributes.externalId);
      return {
        ...base,
        id: String(malId),
        externalIds: { kitsu: base.externalIds.kitsu, mal: malId },
      };
    }),
  );

  const items: MappedContentBase[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      items.push(result.value);
    }
  }
  return items;
}

export async function getKitsuAnime(id: string) {
  const data = await fetchKitsu<KitsuResponse<KitsuAnime>>(`/anime/${id}`);
  return data.data;
}

export async function getKitsuEpisodes(animeId: string) {
  const data = await fetchKitsu<KitsuListResponse<KitsuEpisode>>(
    `/anime/${animeId}/episodes?page[limit]=500`,
  );
  return data.data;
}

export async function getKitsuByMalId(malId: number) {
  const mapped = await fetchKitsu<KitsuListResponse<KitsuMapping>>(
    `/mappings?filter[externalId]=${malId}&filter[externalSite]=myanimelist/anime&include=item&page[limit]=1`,
  );

  const fromMapping = mapped.included?.find(
    (item): item is KitsuAnime => item.type === "anime",
  );
  if (fromMapping) return fromMapping;

  const data = await fetchKitsu<KitsuListResponse<KitsuAnime>>(
    `/anime?filter[text]=${malId}&page[limit]=5`,
  );

  for (const anime of data.data) {
    const mappings = await getKitsuMappings(anime.id);
    const malMapping = mappings.find(
      (m) =>
        m.attributes.externalSite === "myanimelist/anime" &&
        m.attributes.externalId === String(malId),
    );
    if (malMapping) return anime;
  }

  return data.data[0] ?? null;
}

export async function getKitsuMappings(animeId: string) {
  const data = await fetchKitsu<KitsuListResponse<KitsuMapping>>(
    `/anime/${animeId}/mappings`,
  );
  return data.data;
}

export function mapKitsuToItem(anime: KitsuAnime) {
  const attrs = anime.attributes;
  const title =
    attrs.titles?.en ??
    attrs.canonicalTitle ??
    attrs.titles?.en_jp ??
    attrs.titles?.ja_jp ??
    "";

  return {
    id: anime.id,
    type: "anime" as const,
    title,
    description: attrs.synopsis ?? undefined,
    poster: attrs.posterImage?.medium ?? attrs.posterImage?.small,
    backdrop:
      attrs.coverImage?.original ??
      attrs.coverImage?.large ??
      attrs.posterImage?.large,
    rating: attrs.averageRating ? Number(attrs.averageRating) / 10 : undefined,
    externalIds: {
      kitsu: anime.id,
    },
    trailer: attrs.youtubeVideoId
      ? `https://www.youtube.com/watch?v=${attrs.youtubeVideoId}`
      : undefined,
    _raw: anime,
  };
}

export function mapKitsuEpisode(ep: KitsuEpisode) {
  const attrs = ep.attributes;
  return {
    id: ep.id,
    number: attrs.number ?? 0,
    season: attrs.seasonNumber,
    title:
      attrs.titles?.en ??
      attrs.titles?.canonical ??
      attrs.titles?.en_jp ??
      `Episode ${attrs.number ?? ""}`,
    description: attrs.synopsis ?? undefined,
    airDate: attrs.airdate,
    aired: attrs.airdate,
    runtime: attrs.length,
    still:
      attrs.thumbnail?.medium ??
      attrs.thumbnail?.small ??
      attrs.thumbnail?.large,
    externalIds: { kitsu: ep.id },
  };
}
