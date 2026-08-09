const JIKAN_BASE = "https://api.jikan.moe/v4";

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english?: string;
  title_japanese?: string;
  titles?: Array<{ type: string; title: string }>;
  synopsis?: string;
  images?: {
    jpg?: { image_url?: string; large_image_url?: string };
  };
  year?: number;
  score?: number;
  genres?: Array<{ name: string }>;
  explicit_genres?: Array<{ name: string }>;
  themes?: Array<{ name: string }>;
  demographics?: Array<{ name: string }>;
  rating?: string;
  episodes?: number;
  status?: string;
  duration?: string;
}

interface JikanEpisode {
  mal_id: number;
  title: string;
  episode: number;
  aired?: string;
  filler: boolean;
}

async function fetchJikan<T>(path: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(`${JIKAN_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Jikan error: ${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

interface JikanPagination {
  items?: { total?: number };
}

export async function getJikanTopAnime(page = 1, limit = 20) {
  const { items } = await getJikanTopAnimePage(page, limit);
  return items;
}

export async function getJikanTopAnimePage(page = 1, limit = 20) {
  // Main (SFW) site: force Jikan SFW filter so hentai / Rx never leaks into top lists.
  const data = await fetchJikan<{ data: JikanAnime[]; pagination?: JikanPagination }>(
    `/top/anime?page=${page}&limit=${limit}&sfw=true`,
  );
  const items = data.data;
  const total = data.pagination?.items?.total ?? items.length;
  return { items, total };
}

/** Hentai (12) + Ecchi (9) catalog pages for the NSFW site. */
export async function getJikanAdultAnimePage(page = 1, limit = 25) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), 25);

  async function loadGenre(genreId: number) {
    try {
      return await fetchJikan<{ data: JikanAnime[]; pagination?: JikanPagination }>(
        `/anime?genres=${genreId}&sfw=false&order_by=members&sort=desc&page=${safePage}&limit=${safeLimit}`,
        12_000,
      );
    } catch {
      return { data: [] as JikanAnime[], pagination: { items: { total: 0 } } };
    }
  }

  const [hentai, ecchi] = await Promise.all([loadGenre(12), loadGenre(9)]);

  const byId = new Map<number, JikanAnime>();
  for (const anime of [...(hentai.data ?? []), ...(ecchi.data ?? [])]) {
    byId.set(anime.mal_id, anime);
  }
  const items = [...byId.values()];
  const total =
    (hentai.pagination?.items?.total ?? 0) + (ecchi.pagination?.items?.total ?? 0);
  return { items, total: total || items.length };
}

export async function searchJikan(query: string, limit = 20) {
  const data = await fetchJikan<{ data: JikanAnime[] }>(
    `/anime?q=${encodeURIComponent(query)}&limit=${limit}`,
    5_000,
  );
  return data.data;
}

export async function getJikanAnime(id: number) {
  const data = await fetchJikan<{ data: JikanAnime }>(`/anime/${id}`);
  return data.data;
}

export async function getJikanEpisodes(animeId: number) {
  const data = await fetchJikan<{ data: JikanEpisode[] }>(
    `/anime/${animeId}/episodes`,
  );
  return data.data;
}

export function pickJikanTitle(anime: JikanAnime, locale: string): string {
  const base = locale.split("-")[0]?.toLowerCase() ?? "en";
  if (base === "en") return anime.title_english ?? anime.title ?? "";

  if (base === "pt") {
    const ptMatch = anime.titles?.find((t) => /portuguese/i.test(t.type));
    if (ptMatch?.title) return ptMatch.title;
  }

  for (const [lang, type] of [
    [base, base.charAt(0).toUpperCase() + base.slice(1)],
    ["es", "Spanish"],
    ["fr", "French"],
  ] as const) {
    if (base !== lang) continue;
    const match = anime.titles?.find((t) => t.type.toLowerCase() === type.toLowerCase());
    if (match?.title) return match.title;
  }

  return anime.title ?? anime.title_english ?? "";
}

function jikanLabelNames(
  ...groups: Array<Array<{ name: string }> | undefined>
): string[] {
  return groups
    .flatMap((group) => group ?? [])
    .map((entry) => entry.name)
    .filter(Boolean);
}

export function mapJikanToItem(anime: JikanAnime) {
  const genreLabels = jikanLabelNames(
    anime.genres,
    anime.explicit_genres,
    anime.themes,
  );
  const ratingLabel = anime.rating?.toLowerCase() ?? "";
  const hasExplicitGenre = genreLabels.some((g) =>
    /^(hentai|erotica|erotic|ecchi)$/i.test(g.trim()),
  );
  // MAL: "Rx - Hentai", "R+ - Mild Nudity". Do not treat "R - 17+" as hard adult alone.
  const isHardAdultRating =
    ratingLabel.includes("rx") ||
    ratingLabel.includes("hentai") ||
    ratingLabel.startsWith("r+") ||
    ratingLabel.includes("r+ -");
  return {
    id: String(anime.mal_id),
    type: "anime" as const,
    title: anime.title ?? anime.title_english ?? "",
    description: anime.synopsis ?? undefined,
    poster: anime.images?.jpg?.image_url,
    backdrop: anime.images?.jpg?.large_image_url,
    year: anime.year,
    rating: anime.score,
    // Surface explicit + theme labels so UI/filters see hentai/erotica too.
    genres: [...new Set(genreLabels)],
    externalIds: { mal: anime.mal_id },
    _adultCheck: {
      isAdult: hasExplicitGenre || isHardAdultRating,
      // Hentai often lives in explicit_genres, not genres.
      genres: genreLabels,
      tags: jikanLabelNames(anime.explicit_genres, anime.themes),
      rating: anime.rating,
      title: [anime.title, anime.title_english].filter(Boolean).join(" "),
    },
    _raw: anime,
  };
}

export function mapJikanEpisode(ep: JikanEpisode, index = 0) {
  const num = ep.episode ?? index + 1;
  return {
    id: String(ep.mal_id),
    number: num,
    title: ep.title ?? `Episode ${num}`,
    airDate: ep.aired,
  };
}
