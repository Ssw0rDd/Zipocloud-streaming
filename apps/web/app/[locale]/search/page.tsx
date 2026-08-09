"use client";

import { use, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import { AlertCircle, SearchX } from "lucide-react";
import { ContentCard } from "@/components/ContentCard";
import { SearchBar } from "@/components/SearchBar";
import { GridSkeleton } from "@/components/Skeleton";
import { PageTransition } from "@/components/ContentRow";
import { Pagination } from "@/components/Pagination";
import { searchContent } from "@/lib/api";
import { SEARCH_STALE_TIME, queryKeys } from "@/lib/query-config";
import { canonicalizeGenres, type ContentType } from "@zipo/shared";

const PAGE_SIZE = 24;

function SearchEmptyState({ query }: { query: string }) {
  const t = useTranslations("common");

  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zipo-elevated">
        <SearchX className="h-8 w-8 text-zipo-muted" aria-hidden="true" />
      </div>
      <p className="text-lg font-medium text-zipo-text">{t("searchEmptyTitle")}</p>
      <p className="mt-2 max-w-sm text-sm text-zipo-muted">
        {t("searchEmptyHint", { query })}
      </p>
    </div>
  );
}

function SearchErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("common");

  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zipo-elevated">
        <AlertCircle className="h-8 w-8 text-zipo-muted" aria-hidden="true" />
      </div>
      <p className="text-lg font-medium text-zipo-text">{t("searchErrorTitle")}</p>
      <p className="mt-2 max-w-sm text-sm text-zipo-muted">{t("searchErrorHint")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 rounded-lg bg-zipo-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        {t("retry")}
      </button>
    </div>
  );
}

function SearchResults() {
  const searchParams = useSearchParams();
  const locale = useLocale();
  const query = searchParams.get("q") ?? "";
  const typeParam = searchParams.get("type");
  const type: ContentType | undefined = typeParam === "movie" || typeParam === "series" || typeParam === "anime"
    ? typeParam
    : undefined;
  const genres = canonicalizeGenres(searchParams.get("genres")?.split(","));
  const filterKey = `${type ?? "all"}:${genres.join(",")}`;

  const { data, isLoading, isFetching, isError, refetch, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: queryKeys.search(`${query}:${filterKey}`, locale),
      queryFn: ({ pageParam = 0 }) =>
        searchContent(query, type, { skip: pageParam, limit: PAGE_SIZE, locale, genres }),
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
        return loaded < lastPage.total ? loaded : undefined;
      },
      initialPageParam: 0,
      enabled: query.length > 0,
      staleTime: SEARCH_STALE_TIME,
      retry: 1,
    });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const showSkeleton = isLoading || (isFetching && !data && !isError);

  return (
    <>
      {showSkeleton ? (
        <GridSkeleton count={8} />
      ) : isError ? (
        <SearchErrorState onRetry={() => void refetch()} />
      ) : items.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((item, i) => (
              <ContentCard key={`${item.id}-${i}`} item={item} index={i} />
            ))}
          </div>
          <Pagination
            total={total}
            loaded={items.length}
            onLoadMore={() => void fetchNextPage()}
            isLoading={isFetchingNextPage}
          />
        </>
      ) : query ? (
        <SearchEmptyState query={query} />
      ) : null}
    </>
  );
}

function SearchPageContent() {
  const t = useTranslations("common");
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const typeParam = searchParams.get("type");
  const initialType = typeParam === "movie" || typeParam === "series" || typeParam === "anime"
    ? typeParam
    : "all";
  const initialGenres = canonicalizeGenres(searchParams.get("genres")?.split(","));

  return (
    <PageTransition>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-4xl font-bold tracking-wide text-zipo-text">{t("search")}</h1>
        <div className="mt-6 max-w-xl">
          <SearchBar syncWithUrl initialQuery={initialQuery} initialType={initialType} initialGenres={initialGenres} />
        </div>
        <div className="mt-10">
          <SearchResults />
        </div>
      </div>
    </PageTransition>
  );
}

export default function SearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  use(params);

  return (
    <Suspense fallback={<GridSkeleton count={8} />}>
      <SearchPageContent />
    </Suspense>
  );
}
