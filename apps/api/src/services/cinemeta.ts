const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

interface CinemetaMeta {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  year?: string;
  imdbRating?: string;
  genre?: string[];
  runtime?: string;
  director?: string[];
  cast?: string[];
  released?: string;
  trailers?: Array<{ source?: string; type?: string }>;
  trailerStreams?: Array<{ ytId?: string; source?: string }>;
}

interface CinemetaCatalogResponse {
  metas: CinemetaMeta[];
}

async function fetchCinemeta<T>(path: string): Promise<T> {
  const res = await fetch(`${CINEMETA_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Cinemeta error: ${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

function cinemetaExtraPath(extras: Record<string, string | number | undefined>): string {
  const parts = Object.entries(extras)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `/${parts.join("&")}` : "";
}

export async function getCinemetaCatalogPage(
  type: "movie" | "series",
  skip = 0,
  genre?: string,
) {
  const data = await fetchCinemeta<CinemetaCatalogResponse>(
    `/catalog/${type}/top${cinemetaExtraPath({
      genre,
      skip: skip > 0 ? skip : undefined,
    })}.json`,
  );
  return data.metas ?? [];
}

/** @deprecated Prefer getCinemetaCatalogPage — top.json is only the first page. */
export async function getCinemetaCatalogAll(type: "movie" | "series") {
  return getCinemetaCatalogPage(type, 0);
}

export async function getCinemetaCatalog(
  type: "movie" | "series",
  skip = 0,
  limit = 20,
  genre?: string,
) {
  // Cinemeta returns ~50 items per skip window; stitch windows until filled.
  const items: CinemetaMeta[] = [];
  let cursor = Math.max(0, skip);
  while (items.length < limit) {
    const page = await getCinemetaCatalogPage(type, cursor, genre);
    if (page.length === 0) break;
    items.push(...page);
    cursor += page.length;
    if (page.length < 20) break;
  }
  return items.slice(0, limit);
}


export async function getCinemetaMeta(type: "movie" | "series", id: string) {
  const data = await fetchCinemeta<{ meta: CinemetaMeta }>(
    `/meta/${type}/${id}.json`,
  );
  return data.meta;
}

export async function searchCinemeta(query: string, type?: "movie" | "series") {
  const types = type ? [type] : (["movie", "series"] as const);
  const results: CinemetaMeta[] = [];

  await Promise.all(
    types.map(async (t) => {
      try {
        const data = await fetchCinemeta<CinemetaCatalogResponse>(
          `/catalog/${t}/top/search=${encodeURIComponent(query)}.json`,
        );
        results.push(...(data.metas ?? []));
      } catch {
        // search may fail for some types
      }
    }),
  );

  return results;
}

export function mapCinemetaToItem(
  meta: CinemetaMeta,
  type: "movie" | "series",
) {
  return {
    id: meta.id,
    type,
    title: meta.name,
    description: meta.description,
    poster: meta.poster,
    backdrop: meta.background,
    year: meta.year ? Number(meta.year) : undefined,
    rating: meta.imdbRating ? Number(meta.imdbRating) : undefined,
    genres: meta.genre,
    externalIds: { imdb: meta.id },
    _adultCheck: {
      genres: meta.genre,
      title: meta.name,
    },
    _raw: meta,
  };
}

export type CinemetaMapped = ReturnType<typeof mapCinemetaToItem>;
