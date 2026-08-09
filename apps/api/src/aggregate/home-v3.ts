import { createHash } from "node:crypto";
import type { ContentItem, HomeDocumentV3, SiteMode } from "@zipo/shared";
import { env } from "../env";
import { cacheGet, cacheSet, getRedis } from "../lib/redis";
import { composeHomeAggregate } from "./home-orchestrator";
import { rewriteContentItemList } from "../services/image-assets";

const FRESH_TTL_SECONDS = 120;
const STALE_WINDOW_SECONDS = 600;
const LOCK_TTL_SECONDS = 30;

interface HomeV3CacheEntry {
  document: HomeDocumentV3;
  generatedAtMs: number;
}

function cacheKey(locale: string, siteMode: SiteMode = "main"): string {
  return `home:v3:${siteMode}:${locale}`;
}

function lockKey(locale: string, siteMode: SiteMode = "main"): string {
  return `home:v3:lock:${siteMode}:${locale}`;
}

function sectionTitle(id: string, locale: string): string {
  const titles: Record<string, Record<string, string>> = {
    movies: { pt: "Filmes", en: "Movies", es: "Películas" },
    series: { pt: "Séries", en: "Series", es: "Series" },
    anime: { pt: "Anime", en: "Anime", es: "Anime" },
  };
  return titles[id]?.[locale] ?? titles[id]?.en ?? id;
}

async function acquireLock(locale: string, siteMode: SiteMode = "main"): Promise<boolean> {
  try {
    const result = await getRedis().set(lockKey(locale, siteMode), "1", "EX", LOCK_TTL_SECONDS, "NX");
    return result === "OK";
  } catch {
    return true; // proceed without lock if Redis is down
  }
}

async function releaseLock(locale: string, siteMode: SiteMode = "main"): Promise<void> {
  try {
    await getRedis().del(lockKey(locale, siteMode));
  } catch {
    // ignore
  }
}

async function buildHomeDocument(
  locale: string,
  cacheStatus: HomeDocumentV3["meta"]["cacheStatus"],
  stale: boolean,
  siteMode: SiteMode = "main",
): Promise<HomeDocumentV3> {
  const home = await composeHomeAggregate(locale, siteMode);
  const partial = Boolean(home.errors && Object.keys(home.errors).length > 0);

  let featuredMovies = home.featured.movies as ContentItem[];
  let featuredSeries = home.featured.series as ContentItem[];
  let featuredAnime = home.featured.anime as ContentItem[];
  let movies = home.movies.items;
  let series = home.series.items;
  let anime = home.anime.items;

  if (env.IMAGE_PIPELINE_V2) {
    [featuredMovies, featuredSeries, featuredAnime, movies, series, anime] =
      await Promise.all([
        rewriteContentItemList(featuredMovies),
        rewriteContentItemList(featuredSeries),
        rewriteContentItemList(featuredAnime),
        rewriteContentItemList(movies),
        rewriteContentItemList(series),
        rewriteContentItemList(anime),
      ]);
  }

  const generatedAt = new Date().toISOString();

  return {
    data: {
      featured: {
        ...home.featured,
        movies: featuredMovies,
        series: featuredSeries,
        anime: featuredAnime,
      },
      sections: [
        {
          id: "movies",
          title: sectionTitle("movies", locale),
          type: "movie",
          items: movies,
        },
        {
          id: "series",
          title: sectionTitle("series", locale),
          type: "series",
          items: series,
        },
        {
          id: "anime",
          title: sectionTitle("anime", locale),
          type: "anime",
          items: anime,
        },
      ],
    },
    meta: {
      generatedAt,
      stale,
      partial,
      cacheStatus,
    },
  };
}

async function storeDocument(
  locale: string,
  document: HomeDocumentV3,
  siteMode: SiteMode = "main",
): Promise<void> {
  const entry: HomeV3CacheEntry = {
    document,
    generatedAtMs: Date.parse(document.meta.generatedAt) || Date.now(),
  };
  await cacheSet(cacheKey(locale, siteMode), entry, STALE_WINDOW_SECONDS);
}

async function refreshInBackground(locale: string, siteMode: SiteMode = "main"): Promise<void> {
  const locked = await acquireLock(locale, siteMode);
  if (!locked) return;
  try {
    const document = await buildHomeDocument(locale, "fresh", false, siteMode);
    await storeDocument(locale, document, siteMode);
  } catch (err) {
    console.warn(
      `[home-v3] background refresh failed (${siteMode}/${locale}):`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    await releaseLock(locale, siteMode);
  }
}

export function homeV3ETag(locale: string, generatedAt: string, siteMode: SiteMode = "main"): string {
  const hash = createHash("sha1")
    .update(siteMode)
    .update("\0")
    .update(locale)
    .update("\0")
    .update(generatedAt)
    .digest("hex")
    .slice(0, 16);
  return `"h3-${siteMode}-${locale}-${hash}"`;
}

export async function composeHomeV3(
  locale: string,
  siteMode: SiteMode = "main",
): Promise<{ document: HomeDocumentV3; timingMs: number }> {
  const started = performance.now();
  const normalized = locale.trim() || "en";

  if (!env.HOME_CACHE_V3) {
    const document = await buildHomeDocument(normalized, "bypass", false, siteMode);
    return { document, timingMs: performance.now() - started };
  }

  const cached = await cacheGet<HomeV3CacheEntry>(cacheKey(normalized, siteMode));
  const now = Date.now();

  if (cached?.document) {
    const ageSeconds = Math.max(0, (now - cached.generatedAtMs) / 1000);
    if (ageSeconds <= FRESH_TTL_SECONDS) {
      const document: HomeDocumentV3 = {
        ...cached.document,
        meta: {
          ...cached.document.meta,
          stale: false,
          cacheStatus: "fresh",
        },
      };
      return { document, timingMs: performance.now() - started };
    }

    if (ageSeconds <= STALE_WINDOW_SECONDS) {
      void refreshInBackground(normalized, siteMode);
      const document: HomeDocumentV3 = {
        ...cached.document,
        meta: {
          ...cached.document.meta,
          stale: true,
          cacheStatus: "stale",
        },
      };
      return { document, timingMs: performance.now() - started };
    }
  }

  const locked = await acquireLock(normalized, siteMode);
  try {
    // Double-check after acquiring lock
    if (locked) {
      const again = await cacheGet<HomeV3CacheEntry>(cacheKey(normalized, siteMode));
      if (again?.document) {
        const ageSeconds = Math.max(0, (now - again.generatedAtMs) / 1000);
        if (ageSeconds <= FRESH_TTL_SECONDS) {
          return {
            document: {
              ...again.document,
              meta: { ...again.document.meta, stale: false, cacheStatus: "fresh" },
            },
            timingMs: performance.now() - started,
          };
        }
      }
    }

    const document = await buildHomeDocument(normalized, "miss", false, siteMode);
    await storeDocument(normalized, document, siteMode);
    return { document, timingMs: performance.now() - started };
  } finally {
    if (locked) await releaseLock(normalized, siteMode);
  }
}

/** Warm Redis home:v3 entries for the given locales (main site). */
export async function warmHomeV3(locales: string[] = ["pt", "en", "es"]): Promise<void> {
  if (!env.HOME_CACHE_V3) return;
  await Promise.all(
    locales.map(async (locale) => {
      try {
        const document = await buildHomeDocument(locale, "fresh", false, "main");
        await storeDocument(locale, document, "main");
      } catch (err) {
        console.warn(
          `[home-v3] warm failed (${locale}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );
}
