const WIKI_LOCALES: Record<string, string> = {
  pt: "pt",
  en: "en",
  es: "es",
  zh: "zh",
  fr: "fr",
  de: "de",
  it: "it",
  ja: "ja",
  ko: "ko",
};

function wikiLang(locale: string): string {
  const base = locale.split("-")[0]?.toLowerCase() ?? "en";
  return WIKI_LOCALES[base] ?? "en";
}

export interface LocalizedDescription {
  text: string;
  lang: string;
  source: "wikipedia" | "trakt" | "omdb" | "tmdb" | "original";
  isOriginal?: boolean;
}

export interface LocalizedMetadata {
  title?: string;
  description?: LocalizedDescription;
}

async function wikipediaOpenSearchTitles(
  query: string,
  locale: string,
  limit = 3,
): Promise<string[]> {
  const lang = wikiLang(locale);
  try {
    const params = new URLSearchParams({
      action: "opensearch",
      search: query,
      limit: String(limit),
      namespace: "0",
      format: "json",
    });
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[]];
    return data[1] ?? [];
  } catch {
    return [];
  }
}

async function fetchWikipediaPageSummary(
  pageTitle: string,
  locale: string,
): Promise<LocalizedDescription | null> {
  const lang = wikiLang(locale);
  const enc = encodeURIComponent(pageTitle.replace(/ /g, "_"));
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { extract?: string; lang?: string; title?: string };
    if (data.extract && data.extract.length > 40) {
      return {
        text: data.extract,
        lang: data.lang ?? lang,
        source: "wikipedia",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Busca por query no idioma do usuário (opensearch) e retorna resumo. */
export async function fetchWikipediaSummaryByQuery(
  query: string,
  locale: string,
): Promise<(LocalizedDescription & { title?: string }) | null> {
  const candidates = await wikipediaOpenSearchTitles(query, locale);
  for (const title of candidates) {
    const summary = await fetchWikipediaPageSummary(title, locale);
    if (summary) return { ...summary, title };
  }
  return null;
}

async function fetchWikipediaSummary(
  title: string,
  locale: string,
  year?: number,
): Promise<LocalizedDescription | null> {
  const searchTitle = year ? `${title} (${year} film)` : title;
  const candidates = await wikipediaOpenSearchTitles(searchTitle, locale, 2);
  const titlesToTry = [...new Set([...candidates, searchTitle, title])];

  for (const candidate of titlesToTry) {
    const summary = await fetchWikipediaPageSummary(candidate, locale);
    if (summary) return summary;
  }

  return null;
}

export async function fetchOmdbPlot(
  imdbId: string,
  apiKey?: string,
): Promise<LocalizedDescription | null> {
  if (!apiKey) return null;
  const id = imdbId.startsWith("tt") ? imdbId : `tt${imdbId}`;
  try {
    const res = await fetch(
      `https://www.omdbapi.com/?i=${encodeURIComponent(id)}&plot=full&apikey=${encodeURIComponent(apiKey)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { Plot?: string; Response?: string };
    if (data.Response === "False" || !data.Plot || data.Plot === "N/A") return null;
    return { text: data.Plot, lang: "en", source: "omdb" };
  } catch {
    return null;
  }
}

export async function fetchTraktOverview(
  type: "movie" | "series",
  imdbId: string,
  clientId?: string,
): Promise<LocalizedDescription | null> {
  if (!clientId) return null;
  const id = imdbId.startsWith("tt") ? imdbId : `tt${imdbId}`;
  const path = type === "movie" ? "movies" : "shows";
  try {
    const res = await fetch(`https://api.trakt.tv/search/imdb/${id}?type=${type === "movie" ? "movie" : "show"}`, {
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": clientId,
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ [key: string]: { overview?: string } }>;
    const item = data[0]?.[type === "movie" ? "movie" : "show"];
    if (!item?.overview) return null;
    return { text: item.overview, lang: "en", source: "trakt" };
  } catch {
    return null;
  }
}

export async function resolveLocalizedMetadata(options: {
  locale: string;
  title: string;
  year?: number;
  type: "movie" | "series" | "anime";
  imdbId?: string;
  originalDescription?: string;
  traktClientId?: string;
  omdbApiKey?: string;
  tmdbApiKey?: string;
}): Promise<LocalizedMetadata> {
  const { locale, title, year, type, imdbId, originalDescription } = options;
  const baseLang = wikiLang(locale);
  const result: LocalizedMetadata = {};

  if (imdbId && options.tmdbApiKey && (type === "movie" || type === "series")) {
    const { tmdbFindByImdb } = await import("./tmdb");
    const tmdb = await tmdbFindByImdb(imdbId, locale, options.tmdbApiKey);
    if (tmdb) {
      result.title = tmdb.title;
      if (tmdb.overview) {
        result.description = {
          text: tmdb.overview,
          lang: tmdb.resolvedDescriptionLocale ?? "original",
          source: "tmdb",
        };
      }
      if (result.title && result.description) return result;
    }
  }

  const wiki = await fetchWikipediaSummary(title, locale, type === "movie" ? year : undefined);
  if (wiki && !result.description) result.description = wiki;

  if (!result.description && imdbId && (type === "movie" || type === "series")) {
    const trakt = await fetchTraktOverview(type, imdbId, options.traktClientId);
    if (trakt && baseLang === "en") result.description = trakt;

    if (!result.description) {
      const omdb = await fetchOmdbPlot(imdbId, options.omdbApiKey);
      if (omdb && baseLang === "en") result.description = omdb;
    }
  }

  if (!result.description && originalDescription) {
    result.description = {
      text: originalDescription,
      lang: "en",
      source: "original",
      isOriginal: true,
    };
  }

  if (!result.title && baseLang !== "en") {
    const wikiByQuery = await fetchWikipediaSummaryByQuery(title, locale);
    if (wikiByQuery?.title) result.title = wikiByQuery.title;
  }

  return result;
}

export async function resolveLocalizedDescription(options: {
  locale: string;
  title: string;
  year?: number;
  type: "movie" | "series" | "anime";
  imdbId?: string;
  originalDescription?: string;
  traktClientId?: string;
  omdbApiKey?: string;
}): Promise<LocalizedDescription | null> {
  const { locale, title, year, type, imdbId, originalDescription } = options;
  const baseLang = wikiLang(locale);

  const wiki = await fetchWikipediaSummary(title, locale, type === "movie" ? year : undefined);
  if (wiki) return wiki;

  if (imdbId && (type === "movie" || type === "series")) {
    const trakt = await fetchTraktOverview(type, imdbId, options.traktClientId);
    if (trakt && baseLang === "en") return trakt;

    const omdb = await fetchOmdbPlot(imdbId, options.omdbApiKey);
    if (omdb && baseLang === "en") return omdb;
  }

  if (originalDescription) {
    return {
      text: originalDescription,
      lang: "en",
      source: "original",
      isOriginal: true,
    };
  }

  return null;
}

export async function fetchWikipediaPersonBio(
  name: string,
  locale: string,
): Promise<string | null> {
  const result = await fetchWikipediaSummary(name, locale);
  return result?.text ?? null;
}
