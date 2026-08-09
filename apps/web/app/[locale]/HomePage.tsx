"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Hero } from "@/components/Hero";
import { ContentRow, PageTransition } from "@/components/ContentRow";
import { ContinueWatchingRow } from "@/components/ContinueWatchingRow";
import { HeroSkeleton, GridSkeleton } from "@/components/Skeleton";
import { ResilientImage } from "@/components/ResilientImage";
import {
  fetchCatalog,
  fetchFeatured,
  fetchHomeAggregated,
  fetchPersonalizedHome,
  getBackdropUrl,
  getPosterUrl,
  type ContentItem,
  type PersonalizedHomeSection,
} from "@/lib/api";
import { getActiveProfileId } from "@/lib/api-client";
import { CATALOG_STALE_TIME, queryKeys } from "@/lib/query-config";
import { isNsfwSite } from "@/lib/site-mode";
import { watchEpisodeQuery } from "@/lib/watch-episode";

function HomeSectionError({ onRetry }: { onRetry: () => void }) {
  const tc = useTranslations("common");
  return (
    <div className="rounded-2xl border border-zipo-border bg-zipo-surface px-4 py-8 text-center">
      <p className="text-sm text-zipo-muted">{tc("error")}</p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-4 text-sm">{tc("retry")}</button>
    </div>
  );
}

function CatalogRow({
  title,
  items,
  seeAllHref,
  isLoading,
  isError,
  onRetry,
}: {
  title: string;
  items: ContentItem[];
  seeAllHref?: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) return <GridSkeleton />;
  if (isError) return <HomeSectionError onRetry={onRetry} />;
  if (!items.length) return null;
  return <ContentRow title={title} items={items} seeAllHref={seeAllHref} />;
}

function continueHref(item: PersonalizedHomeSection["items"][number]) {
  let href = `/watch/${item.type}/${item.id}`;
  if (item.type !== "movie") {
    href += watchEpisodeQuery(item.progress?.episodeNumber ?? undefined, item.progress?.seasonNumber ?? undefined);
    return `${href}&resume=1`;
  }
  return `${href}?resume=1`;
}

function PersonalizedContinueRow({ section, title }: { section: PersonalizedHomeSection; title: string }) {
  const th = useTranslations("history");
  return (
    <section className="py-8 sm:py-11" aria-labelledby="continue-title">
      <div className="mb-5 flex items-end justify-between gap-3">
        <h2 id="continue-title" className="text-xl font-semibold tracking-tight text-zipo-text sm:text-2xl">{title}</h2>
        <Link href="/profile/history" className="shrink-0 text-sm font-medium text-zipo-accent hover:underline">
          {th("title")}
        </Link>
      </div>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 [scrollbar-width:thin]">
        {section.items.map((item) => {
          const duration = item.progress?.durationSeconds ?? 0;
          const progress = duration > 0 ? Math.min(100, Math.max(0, ((item.progress?.progressSeconds ?? 0) / duration) * 100)) : 0;
          return (
            <Link key={`${item.type}:${item.id}`} href={continueHref(item)} className="group w-[78vw] max-w-[370px] shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zipo-accent" aria-label={`${title}: ${item.title}`}>
              <div className="relative aspect-video overflow-hidden rounded-xl bg-zipo-elevated">
                <ResilientImage candidates={[getBackdropUrl(item), ...(item.stillCandidates ?? []), getPosterUrl(item)]} alt={item.title} sizes="(max-width: 640px) 78vw, 370px" className="object-cover transition duration-500 group-hover:scale-[1.025]" placeholderLabel={item.title} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20"><div className="h-full bg-zipo-accent" style={{ width: `${progress}%` }} /></div>
                <span className="absolute bottom-4 left-4 right-4 flex items-center gap-2 truncate text-sm font-semibold text-white"><Play className="h-4 w-4 fill-current text-zipo-accent" />{item.title}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function HomePage() {
  const t = useTranslations("home");
  const locale = useLocale();
  const nsfw = isNsfwSite();
  const [activeProfile, setActiveProfile] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setActiveProfile(getActiveProfileId());
    sync();
    window.addEventListener("zipo:profile-change", sync);
    return () => window.removeEventListener("zipo:profile-change", sync);
  }, []);

  const home = useQuery({
    queryKey: queryKeys.personalizedHome(locale, activeProfile),
    queryFn: () => fetchPersonalizedHome(locale),
    staleTime: 60_000,
    retry: 1,
  });

  const aggregated = useQuery({
    queryKey: queryKeys.homeAggregate(locale),
    queryFn: () => fetchHomeAggregated(locale),
    staleTime: CATALOG_STALE_TIME,
    enabled: home.isError,
  });
  const featuredQuery = useQuery({ queryKey: queryKeys.featuredHome(locale), queryFn: () => fetchFeatured(false, locale), staleTime: CATALOG_STALE_TIME, enabled: home.isError && aggregated.isError });
  const moviesQuery = useQuery({ queryKey: queryKeys.homeCatalog("movie", locale), queryFn: () => fetchCatalog("movie", { limit: 12, locale }), staleTime: CATALOG_STALE_TIME, enabled: home.isError && aggregated.isError });
  const seriesQuery = useQuery({ queryKey: queryKeys.homeCatalog("series", locale), queryFn: () => fetchCatalog("series", { limit: 12, locale }), staleTime: CATALOG_STALE_TIME, enabled: home.isError && aggregated.isError });
  const animeQuery = useQuery({ queryKey: queryKeys.homeCatalog("anime", locale), queryFn: () => fetchCatalog("anime", { limit: 12, locale }), staleTime: CATALOG_STALE_TIME, enabled: home.isError && aggregated.isError });

  if (home.isLoading) {
    return <PageTransition><HeroSkeleton /><div className="mx-auto max-w-[1440px] space-y-5 px-4 sm:px-6"><GridSkeleton /><GridSkeleton /></div></PageTransition>;
  }

  if (home.data) {
    return (
      <PageTransition>
        <div data-zp="home" className={nsfw ? "nsfw-home" : "zipo-home-v2"}>
          <Hero featured={home.data.hero ?? undefined} />
          <div className={nsfw ? "mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8" : "mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10"}>
            {home.data.sections.map((section) => {
              if (!section.items.length) return null;
              // Guest fallback used to map both `for-you` and `trending` to "Em alta".
              // Keep a single ranked rail when personalization is off.
              if (section.id === "for-you" && !home.data.personalized) return null;
              const title =
                section.id === "continue"
                  ? t("keepWatching")
                  : section.id === "for-you"
                    ? t("forYou")
                    : section.id === "because"
                      ? t("becauseYouLike")
                      : section.id === "trending"
                        ? t("trending")
                        : section.title;
              return section.layout === "landscape"
                ? <PersonalizedContinueRow key={section.id} section={section} title={title} />
                : <ContentRow
                    key={section.id}
                    title={title}
                    items={section.items}
                    ranked={section.layout === "ranked"}
                    recommendationRail={section.id}
                    reasons={locale.toLowerCase().startsWith("pt") ? home.data.reasons : undefined}
                    feedbackEnabled={home.data.personalized && section.id !== "trending"}
                  />;
            })}
          </div>
        </div>
      </PageTransition>
    );
  }

  const useDirectFallback = aggregated.isError;
  const featuredData = useDirectFallback ? featuredQuery.data : aggregated.data?.featured;
  const moviesData = useDirectFallback ? moviesQuery.data : aggregated.data?.movies;
  const seriesData = useDirectFallback ? seriesQuery.data : aggregated.data?.series;
  const animeData = useDirectFallback ? animeQuery.data : aggregated.data?.anime;
  const featuredItem = featuredData?.movies[0] ?? featuredData?.series[0] ?? featuredData?.anime[0];
  const retryAll = () => { void home.refetch(); void aggregated.refetch(); };

  return (
    <PageTransition>
      <div data-zp="home" className={nsfw ? "nsfw-home" : undefined}>
        {aggregated.isLoading || featuredQuery.isLoading ? <HeroSkeleton /> : featuredItem ? <Hero featured={featuredItem} /> : <div className="mx-auto max-w-7xl px-4 pt-24"><HomeSectionError onRetry={retryAll} /></div>}
        <div className={nsfw ? "mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8" : "mx-auto max-w-7xl px-4 sm:px-6"}>
          <ContinueWatchingRow />
          <CatalogRow title={t("catalogMovies")} items={moviesData?.items ?? []} seeAllHref="/explore/movie" isLoading={aggregated.isLoading || moviesQuery.isLoading} isError={Boolean(aggregated.data?.errors?.movies) || moviesQuery.isError} onRetry={retryAll} />
          <CatalogRow title={t("catalogSeries")} items={seriesData?.items ?? []} seeAllHref="/explore/series" isLoading={aggregated.isLoading || seriesQuery.isLoading} isError={Boolean(aggregated.data?.errors?.series) || seriesQuery.isError} onRetry={retryAll} />
          <CatalogRow title={t("catalogAnime")} items={animeData?.items ?? []} seeAllHref="/explore/anime" isLoading={aggregated.isLoading || animeQuery.isLoading} isError={Boolean(aggregated.data?.errors?.anime) || animeQuery.isError} onRetry={retryAll} />
        </div>
      </div>
    </PageTransition>
  );
}
