import type { ContentItem, ContentType, SiteMode } from "@zipo/shared";
import { fetchCatalog, fetchFeatured } from "../services/content";

export interface HomeAggregateResult {
  featured: Awaited<ReturnType<typeof fetchFeatured>>;
  movies: { items: ContentItem[]; total: number };
  series: { items: ContentItem[]; total: number };
  anime: { items: ContentItem[]; total: number };
  locale: string;
  errors?: Partial<Record<"featured" | "movies" | "series" | "anime", string>>;
}

export async function composeHomeAggregate(
  locale: string,
  siteMode: SiteMode = "main",
): Promise<HomeAggregateResult> {
  const [featuredResult, moviesResult, seriesResult, animeResult] =
    await Promise.allSettled([
      fetchFeatured(siteMode, locale),
      fetchCatalog("movie", 0, 12, siteMode, locale),
      fetchCatalog("series", 0, 12, siteMode, locale),
      fetchCatalog("anime", 0, 12, siteMode, locale),
    ]);

  const errors: HomeAggregateResult["errors"] = {};

  const featured =
    featuredResult.status === "fulfilled"
      ? featuredResult.value
      : { movies: [], series: [], anime: [], source: "error" as const };
  if (featuredResult.status === "rejected") {
    errors.featured =
      featuredResult.reason instanceof Error
        ? featuredResult.reason.message
        : "featured_failed";
  }

  const movies =
    moviesResult.status === "fulfilled"
      ? moviesResult.value
      : { items: [] as ContentItem[], total: 0 };
  if (moviesResult.status === "rejected") {
    errors.movies =
      moviesResult.reason instanceof Error
        ? moviesResult.reason.message
        : "movies_failed";
  }

  const series =
    seriesResult.status === "fulfilled"
      ? seriesResult.value
      : { items: [] as ContentItem[], total: 0 };
  if (seriesResult.status === "rejected") {
    errors.series =
      seriesResult.reason instanceof Error
        ? seriesResult.reason.message
        : "series_failed";
  }

  const anime =
    animeResult.status === "fulfilled"
      ? animeResult.value
      : { items: [] as ContentItem[], total: 0 };
  if (animeResult.status === "rejected") {
    errors.anime =
      animeResult.reason instanceof Error
        ? animeResult.reason.message
        : "anime_failed";
  }

  return {
    featured,
    movies,
    series,
    anime,
    locale,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

export type { ContentType };
