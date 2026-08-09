"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CANONICAL_GENRES, canonicalizeGenres, genreLabel, type CanonicalGenre, type ContentType } from "@zipo/shared";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { ContentCard } from "@/components/ContentCard";
import { GridSkeleton } from "@/components/Skeleton";
import { PageTransition } from "@/components/ContentRow";
import { Pagination } from "@/components/Pagination";
import { fetchCatalog } from "@/lib/api";
import { CATALOG_STALE_TIME, queryKeys } from "@/lib/query-config";
import { isNsfwSite } from "@/lib/site-mode";
import { usePathname, useRouter } from "@/i18n/routing";

const typeLabels: Record<ContentType, string> = {
  movie: "movies",
  series: "series",
  anime: "anime",
};

const PAGE_SIZE = 24;

const nsfwDescriptions: Record<ContentType, Record<string, string>> = {
  movie: {
    pt: "Longas selecionados para uma experiência mais intensa.",
    es: "Películas seleccionadas para una experiencia más intensa.",
    en: "A curated selection of movies for a more intense experience.",
  },
  series: {
    pt: "Histórias em capítulos para assistir sem pressa.",
    es: "Historias por capítulos para disfrutar sin prisa.",
    en: "Serialized stories made for unhurried watching.",
  },
  anime: {
    pt: "Animações adultas, ousadas e fora do catálogo comum.",
    es: "Animación adulta, audaz y fuera del catálogo habitual.",
    en: "Bold adult animation beyond the usual catalog.",
  },
};

export function ExplorePageClient({
  type,
  locale,
}: {
  type: ContentType;
  locale: string;
}) {
  const t = useTranslations("explore");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const nsfw = isNsfwSite();
  const [genres, setGenres] = useState<CanonicalGenre[]>(() =>
    canonicalizeGenres((searchParams.get("genres") ?? "").split(",")),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const genresKey = genres.join(",");

  const selectGenres = (next: CanonicalGenre[]) => {
    const normalized = canonicalizeGenres(next);
    setGenres(normalized);
    const params = new URLSearchParams(searchParams.toString());
    if (normalized.length > 0) params.set("genres", normalized.join(","));
    else params.delete("genres");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const { data, isLoading, isError, refetch, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: queryKeys.catalog(type, `explore:${genresKey || "all"}`, locale),
      queryFn: ({ pageParam = 0 }) =>
        fetchCatalog(type, { skip: pageParam, limit: PAGE_SIZE, locale, genres }),
      getNextPageParam: (lastPage) => {
        const next = lastPage.skip + lastPage.limit;
        return next < lastPage.total ? next : undefined;
      },
      initialPageParam: 0,
      staleTime: CATALOG_STALE_TIME,
    });

  const label = t(typeLabels[type] ?? "movies");
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const loaded = items.length;

  return (
    <PageTransition>
      <div className={nsfw ? "nsfw-explore mx-auto max-w-[1600px] px-4 pb-16 pt-12 sm:px-6 lg:px-8 lg:pt-16" : "mx-auto max-w-7xl px-4 py-8 sm:px-6"}>
        <div className={nsfw ? "mb-10 max-w-3xl" : "mb-6"}>
          <p className={nsfw ? "nsfw-kicker mb-4" : "text-xs font-semibold uppercase tracking-[0.3em] text-zipo-accent"}>
            {nsfw ? "Catálogo +18" : "ZiPo"}
          </p>
          <h1 className={nsfw ? "font-display text-5xl font-semibold tracking-[-0.045em] text-zipo-text sm:text-7xl" : "text-4xl font-bold tracking-wide text-zipo-text sm:text-5xl"}>
            {t("title", { type: label })}
          </h1>
          {nsfw && (
            <p className="mt-4 max-w-2xl text-base leading-7 text-zipo-muted">
              {nsfwDescriptions[type][locale] ?? nsfwDescriptions[type].en}
            </p>
          )}
          <div className={nsfw ? "mt-6 h-px w-20 bg-gradient-to-r from-zipo-accent to-transparent" : "mt-3 h-px w-24 bg-zipo-accent"} />
        </div>

        <div className={nsfw ? "nsfw-filter-bar sticky top-16 z-20 mb-8 px-4 sm:px-5" : "mb-6 rounded-xl border border-zipo-border bg-zipo-surface"}>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="catalog-genre-filters"
            onClick={() => setFiltersOpen((value) => !value)}
            className={nsfw ? "flex min-h-14 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-zipo-text" : "flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-zipo-text sm:px-5"}
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-zipo-accent" aria-hidden="true" />
              Filtrar gêneros
              {genres.length > 0 && (
                <span className={nsfw ? "border-l border-zipo-border pl-3 text-xs font-medium text-zipo-accent" : "rounded-full bg-zipo-accent/15 px-2 py-0.5 text-xs text-zipo-accent"}>
                  {genres.length}
                </span>
              )}
            </span>
            <ChevronDown className={filtersOpen ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} aria-hidden="true" />
          </button>
          {filtersOpen && (
            <div id="catalog-genre-filters" className={nsfw ? "border-t border-zipo-border-subtle py-5" : "border-t border-zipo-border-subtle p-3 sm:p-4"}>
              <div className={nsfw ? "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7" : "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5"}>
                {CANONICAL_GENRES.map((genre) => {
                  const selected = genres.includes(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectGenres(selected ? genres.filter((entry) => entry !== genre) : [...genres, genre])}
                      className={selected
                        ? "min-h-11 rounded-md border border-zipo-accent bg-zipo-accent/10 px-3 text-left text-sm font-semibold text-zipo-accent"
                        : "min-h-11 rounded-md border border-zipo-border px-3 text-left text-sm text-zipo-muted transition-colors hover:border-zipo-muted hover:text-zipo-text"}
                    >
                      {genreLabel(genre, locale)}
                    </button>
                  );
                })}
              </div>
              {genres.length > 0 && (
                <button type="button" onClick={() => selectGenres([])} className="mt-3 min-h-11 rounded-lg px-3 text-sm font-semibold text-zipo-accent hover:bg-zipo-accent/10">
                  Limpar filtros
                </button>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <GridSkeleton count={12} />
        ) : isError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-10 text-center text-sm text-red-200">
            <p>Não foi possível carregar o catálogo.</p>
            <button type="button" onClick={() => void refetch()} className="mt-4 min-h-11 rounded-lg border border-red-300/30 px-4 font-semibold">
              Tentar novamente
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-zipo-border bg-zipo-surface px-5 py-12 text-center text-sm text-zipo-muted">
            <p>Nenhum título encontrado para os gêneros selecionados.</p>
            {genres.length > 0 && (
              <button type="button" onClick={() => selectGenres([])} className="mt-4 min-h-11 rounded-lg px-4 font-semibold text-zipo-accent hover:bg-zipo-accent/10">
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            <p className={nsfw ? "mb-6 border-l-2 border-zipo-accent pl-3 text-sm tabular-nums text-zinc-400" : "mb-4 text-sm text-zipo-muted"} role="status">
              {genres.length > 0 ? `${total} títulos encontrados` : `${total} títulos no catálogo`}
            </p>
            <div className={nsfw ? "grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" : "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"}>
              {items.map((item, index) => (
                <ContentCard key={`${item.id}-${index}`} item={item} index={index} />
              ))}
            </div>

            <Pagination
              total={total}
              loaded={loaded}
              onLoadMore={() => void fetchNextPage()}
              isLoading={isFetchingNextPage}
            />
          </>
        )}
      </div>
    </PageTransition>
  );
}

export { PAGE_SIZE };
