/**
 * Busca títulos em Wikipedia (pt/en) e resolve IMDb ID via Wikidata — sem API key.
 */
export interface WikidataImdbMatch {
  imdbId: string;
  title: string;
  wikiTitle: string;
}

async function wikipediaOpenSearch(
  query: string,
  lang: string,
  limit = 5,
): Promise<string[]> {
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

async function wikiTitleToWikidataId(title: string, lang: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: "query",
      titles: title,
      prop: "pageprops",
      ppprop: "wikibase_item",
      format: "json",
    });
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> };
    };
    const pages = data.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      if (page.pageprops?.wikibase_item) return page.pageprops.wikibase_item;
    }
    return null;
  } catch {
    return null;
  }
}

async function wikidataToImdbId(wikidataId: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: "wbgetclaims",
      entity: wikidataId,
      property: "P345",
      format: "json",
    });
    const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      claims?: { P345?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> };
    };
    const claim = data.claims?.P345?.[0]?.mainsnak?.datavalue?.value;
    if (!claim || typeof claim !== "string") return null;
    return claim.startsWith("tt") ? claim : `tt${claim}`;
  } catch {
    return null;
  }
}

function wikiLang(locale: string): string {
  const base = locale.split("-")[0]?.toLowerCase() ?? "en";
  if (base === "pt") return "pt";
  if (base === "zh") return "zh";
  if (base === "es") return "es";
  return "en";
}

export async function findImdbIdsFromWikipedia(
  query: string,
  locale: string,
): Promise<WikidataImdbMatch[]> {
  const lang = wikiLang(locale);
  const titles = await wikipediaOpenSearch(query, lang);
  const matches: WikidataImdbMatch[] = [];
  const seen = new Set<string>();

  const resolved = await Promise.all(
    titles.map(async (title) => {
      const wikidataId = await wikiTitleToWikidataId(title, lang);
      if (!wikidataId) return null;
      const imdbId = await wikidataToImdbId(wikidataId);
      if (!imdbId) return null;
      return { imdbId, title, wikiTitle: title };
    }),
  );

  for (const match of resolved) {
    if (!match || seen.has(match.imdbId)) continue;
    seen.add(match.imdbId);
    matches.push(match);
  }

  return matches;
}
