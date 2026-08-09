"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/routing";
import { Play, Star } from "lucide-react";
import { getBackdropUrl, getPosterUrl } from "@/lib/api";
import { fetchEnrichedContent } from "@/lib/enriched-content";
import { formatDuration, formatRating } from "@/lib/utils";
import { ReactionBar } from "@/components/ReactionBar";
import { AddToPlaylistButton } from "@/components/playlists/AddToPlaylistButton";
import { PageTransition } from "@/components/ContentRow";
import { Skeleton } from "@/components/Skeleton";
import {
  DetailTrailer,
  DetailProduction,
  DetailCast,
  DetailSectionSkeleton,
} from "@/components/detail";
import { ResilientImage } from "@/components/ResilientImage";

export function MovieDetailClient({ id }: { id: string }) {
  const t = useTranslations("detail");
  const tc = useTranslations("common");
  const locale = useLocale();
  const type = "movie" as const;

  const { data, isLoading } = useQuery({
    queryKey: ["content", "movie", id, "enriched", locale],
    queryFn: () => fetchEnrichedContent("movie", id, locale),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Skeleton className="h-[50vh] w-full rounded-xl" />
        <DetailSectionSkeleton rows={2} />
        <DetailSectionSkeleton rows={4} />
      </div>
    );
  }

  if (!data) return null;

  const runtime = data.runtime ?? data.duration;

  return (
    <PageTransition>
      <div className="relative">
        {(getBackdropUrl(data) || data.stillCandidates?.length) && (
          <div className="absolute inset-0 h-[60vh]">
            <ResilientImage candidates={[getBackdropUrl(data), ...(data.stillCandidates ?? [])]} alt="" sizes="100vw" className="object-cover opacity-30" placeholderLabel={data.title} />
            <div className="absolute inset-0 bg-gradient-to-t from-zipo-bg via-zipo-bg/60 to-transparent" />
          </div>
        )}

        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-col gap-8 md:flex-row">
            <div className="relative mx-auto aspect-[2/3] w-64 shrink-0 overflow-hidden rounded-2xl border border-zipo-border-subtle bg-zipo-surface shadow-sm sm:w-72 md:mx-0 lg:w-80">
              <ResilientImage
                candidates={[getPosterUrl(data), ...(data.posterCandidates ?? [])]}
                alt={data.title}
                sizes="(max-width: 640px) 16rem, (max-width: 1024px) 18rem, 20rem"
                quality={92}
                className="object-contain"
                placeholderLabel={data.title}
              />
            </div>

            <div className="flex-1">
              <h1 className="text-4xl font-bold tracking-wide text-zipo-text sm:text-5xl">
                {data.title}
              </h1>

              <div className="mt-4 flex flex-wrap gap-4 text-sm text-zipo-muted">
                {data.year && <span>{t("year")}: {data.year}</span>}
                {data.rating && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-zipo-accent text-zipo-accent" aria-hidden="true" />
                    {t("rating")}: {formatRating(data.rating)}
                  </span>
                )}
                {runtime && <span>{t("duration")}: {formatDuration(runtime)}</span>}
              </div>

              {data.genres && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.genres.map((g) => (
                    <span key={g} className="rounded-full border border-zipo-accent/30 px-3 py-1 text-xs text-zipo-accent">
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {data.description && (
                <div className="mt-6 max-w-2xl">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zipo-text">
                    {t("synopsis")}
                  </h2>
                  <p className="mt-2 leading-relaxed text-zipo-muted">{data.description}</p>
                </div>
              )}

              <DetailCast cast={data.cast} castCredits={data.castCredits} />

              <ReactionBar contentType={type} contentId={id} className="mt-6" />

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={`/watch/${type}/${id}`} className="btn-primary">
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  {tc("watchNow")}
                </Link>
                <AddToPlaylistButton contentType={type} contentId={id} />
              </div>
            </div>
          </div>

          <DetailTrailer trailer={data.trailer} title={data.title} />
          <DetailProduction data={data} />
        </div>
      </div>
    </PageTransition>
  );
}
