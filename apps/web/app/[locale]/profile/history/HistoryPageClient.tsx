"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { History, Play, Trash2 } from "lucide-react";
import { Link } from "@/i18n/routing";
import { useAuth } from "@/hooks/useAuth";
import {
  deleteWatchHistoryItem,
  fetchWatchHistory,
  getPosterUrl,
  type ContentType,
} from "@/lib/api";
import { getActiveProfileId } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-config";
import { PageTransition } from "@/components/ContentRow";
import { ResilientImage } from "@/components/ResilientImage";
import { GridSkeleton } from "@/components/Skeleton";
import { watchEpisodeQuery } from "@/lib/watch-episode";
import { formatPlayerTime } from "@/components/player/utils";
import { useEffect, useState } from "react";

function resumeHref(item: {
  contentType: ContentType;
  contentId: string;
  episodeNumber: number | null;
  seasonNumber: number | null;
  completed: boolean;
}) {
  let href = `/watch/${item.contentType}/${item.contentId}`;
  if (item.contentType === "movie") {
    return item.completed ? href : `${href}?resume=1`;
  }
  if (item.episodeNumber) {
    href += watchEpisodeQuery(item.episodeNumber, item.seasonNumber ?? undefined);
    return item.completed ? href : `${href}&resume=1`;
  }
  return item.completed ? href : `${href}?resume=1`;
}

export function HistoryPageClient() {
  const t = useTranslations("history");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setProfileId(getActiveProfileId());
    sync();
    window.addEventListener("zipo:profile-change", sync);
    return () => window.removeEventListener("zipo:profile-change", sync);
  }, []);

  const history = useQuery({
    queryKey: queryKeys.watchHistory(locale, profileId),
    queryFn: () => fetchWatchHistory(locale, 80),
    enabled: isLoggedIn,
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: ({ type, id }: { type: ContentType; id: string }) =>
      deleteWatchHistoryItem(type, id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["watch-history"] }),
        queryClient.invalidateQueries({ queryKey: ["continue-watching"] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
      ]);
    },
  });

  if (authLoading) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <GridSkeleton />
        </div>
      </PageTransition>
    );
  }

  if (!isLoggedIn) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
          <History className="mx-auto mb-4 h-10 w-10 text-zipo-muted" />
          <h1 className="font-display text-2xl text-zipo-text">{t("loginTitle")}</h1>
          <p className="mt-2 text-sm text-zipo-muted">{t("loginText")}</p>
          <Link href="/auth/login" className="btn-primary mt-6 inline-flex">
            {tc("login")}
          </Link>
        </div>
      </PageTransition>
    );
  }

  const items = history.data?.items ?? [];

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zipo-muted">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-zipo-text">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zipo-muted">{t("subtitle")}</p>
          <Link
            href="/"
            className="mt-4 inline-flex text-sm font-medium text-zipo-accent hover:underline"
          >
            {t("seeContinue")}
          </Link>
        </header>

        {history.isLoading ? (
          <GridSkeleton />
        ) : history.isError ? (
          <div className="rounded-xl border border-zipo-border bg-zipo-surface px-4 py-10 text-center">
            <p className="text-sm text-zipo-muted">{tc("error")}</p>
            <button
              type="button"
              onClick={() => void history.refetch()}
              className="btn-secondary mt-4 text-sm"
            >
              {tc("retry")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-zipo-border bg-zipo-surface px-4 py-14 text-center">
            <p className="text-sm text-zipo-muted">{t("empty")}</p>
            <Link href="/explore/movie" className="btn-primary mt-5 inline-flex text-sm">
              {t("browse")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const href = resumeHref(item);
              const progressLabel = item.completed
                ? t("completed")
                : item.durationSeconds
                  ? t("progress", {
                      current: formatPlayerTime(item.progressSeconds),
                      total: formatPlayerTime(item.durationSeconds),
                    })
                  : t("progressShort", {
                      current: formatPlayerTime(item.progressSeconds),
                    });

              return (
                <li
                  key={`${item.contentType}:${item.contentId}:${item.episodeId ?? item.episodeNumber ?? "main"}:${item.updatedAt}`}
                  className="flex gap-3 rounded-xl border border-zipo-border-subtle bg-zipo-surface p-3 sm:gap-4 sm:p-4"
                >
                  <Link
                    href={href}
                    className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-zipo-elevated sm:h-28 sm:w-20"
                  >
                    <ResilientImage
                      candidates={[getPosterUrl({ poster: item.poster })]}
                      alt=""
                      sizes="80px"
                      className="object-cover"
                      placeholderLabel={item.title}
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="block focus-visible:outline-zipo-accent">
                      <h2 className="truncate text-base font-semibold text-zipo-text">
                        {item.title}
                      </h2>
                      <p className="mt-0.5 text-xs capitalize text-zipo-muted">
                        {item.contentType}
                        {item.seasonNumber != null && item.episodeNumber != null
                          ? ` · S${item.seasonNumber}E${item.episodeNumber}`
                          : ""}
                      </p>
                    </Link>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zipo-elevated">
                      <div
                        className="h-full rounded-full bg-zipo-accent"
                        style={{ width: `${item.progressPct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-zipo-muted">{progressLabel}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={href}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-zipo-accent px-3 text-sm font-medium text-[var(--zipo-on-accent)]"
                      >
                        <Play className="h-4 w-4 fill-current" />
                        {item.completed ? t("watchAgain") : t("resume")}
                      </Link>
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate({
                            type: item.contentType,
                            id: item.contentId,
                          })
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-zipo-border-subtle px-3 text-sm text-zipo-muted hover:border-zipo-border hover:text-zipo-text"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("remove")}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageTransition>
  );
}
