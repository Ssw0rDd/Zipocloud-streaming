"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { Play } from "lucide-react";
import { Link } from "@/i18n/routing";
import { fetchContinueWatching, getPosterUrl } from "@/lib/api";
import { queryKeys } from "@/lib/query-config";
import { useAuth } from "@/hooks/useAuth";
import { GridSkeleton } from "./Skeleton";
import { watchEpisodeQuery } from "@/lib/watch-episode";

export function ContinueWatchingRow() {
  const t = useTranslations("home");
  const locale = useLocale();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.continueWatching(locale),
    queryFn: () => fetchContinueWatching(locale),
    staleTime: 0,
    refetchOnMount: "always",
    enabled: isLoggedIn,
  });

  if (authLoading || !isLoggedIn) return null;
  if (isLoading) return <GridSkeleton />;

  const items = data?.items ?? [];
  if (!items.length) return null;

  return (
    <section className="py-10">
      <h2 className="mb-5 text-xl font-semibold text-zipo-text sm:text-2xl">
        {t("keepWatching")}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => {
          const progressPct =
            item.durationSeconds && item.durationSeconds > 0
              ? Math.min(100, (item.progressSeconds / item.durationSeconds) * 100)
              : 0;

          let href = `/watch/${item.contentType}/${item.contentId}`;
          if (item.contentType === "movie") {
            href = `${href}?resume=1`;
          } else if (item.episodeNumber) {
            href = `${href}${watchEpisodeQuery(
              item.episodeNumber,
              item.seasonNumber,
            )}&resume=1`;
          } else if (item.episodeId && item.episodes?.length) {
            const episode = item.episodes.find((candidate) => candidate.id === item.episodeId);
            href = `${href}${watchEpisodeQuery(
              episode?.number,
              episode?.season,
            )}&resume=1`;
          }

          const poster = getPosterUrl({ poster: item.poster });

          return (
            <Link
              key={`${item.contentType}:${item.contentId}`}
              href={href}
              className="group block"
              aria-label={t("continueWatchingItem", { title: item.title })}
            >
              <div className="relative aspect-video overflow-hidden rounded-lg surface-card">
                {poster ? (
                  <Image
                    src={poster}
                    alt=""
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 640px) 50vw, 20vw"
                  />
                ) : (
                  <div className="absolute inset-0 bg-zinc-800" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700/80">
                  <div
                    className="h-full origin-left bg-zipo-accent transition-transform duration-300"
                    style={{ transform: `scaleX(${progressPct / 100})` }}
                  />
                </div>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="rounded-full bg-zipo-accent/90 p-3 shadow-lg">
                    <Play className="h-5 w-5 fill-white text-white" />
                  </div>
                </div>
                <p className="absolute bottom-2 left-2 right-2 truncate text-sm font-medium text-white">
                  {item.title}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
