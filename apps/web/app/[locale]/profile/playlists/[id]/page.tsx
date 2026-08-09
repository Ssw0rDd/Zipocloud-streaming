"use client";

import { use } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import type { ContentType } from "@zipo/shared";
import {
  deletePlaylist,
  fetchPlaylist,
  removeFromPlaylist,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-config";
import { useAuth } from "@/hooks/useAuth";
import { ContentCard } from "@/components/ContentCard";
import { PageTransition } from "@/components/ContentRow";
import { Skeleton } from "@/components/Skeleton";

function PlaylistDetailClient({ id }: { id: string }) {
  const t = useTranslations("playlists");
  const tc = useTranslations("common");
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.playlist(id),
    queryFn: () => fetchPlaylist(id),
    enabled: isLoggedIn,
  });

  const removeMutation = useMutation({
    mutationFn: ({
      contentType,
      contentId,
    }: {
      contentType: ContentType;
      contentId: string;
    }) => removeFromPlaylist(id, contentType, contentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlist(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlaylist(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
      router.push("/profile/playlists");
    },
  });

  if (authLoading || isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Skeleton className="h-10 w-64" />
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="text-zipo-muted">{t("loginRequired")}</p>
        <Link href="/auth/login" className="btn-primary mt-4 inline-flex">
          {tc("login")}
        </Link>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="text-zipo-muted">{t("notFound")}</p>
        <Link href="/profile/playlists" className="mt-4 inline-block text-zipo-accent">
          {t("backToLists")}
        </Link>
      </div>
    );
  }

  const itemsWithContent = data.items.filter((item) => item.content);

  return (
    <PageTransition>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Link
          href="/profile/playlists"
          className="inline-flex items-center gap-2 text-sm text-zipo-muted hover:text-zipo-text"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToLists")}
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zipo-text">{data.name}</h1>
            <p className="mt-1 text-sm text-zipo-muted">
              {t("itemCount", { count: itemsWithContent.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t("deleteConfirm"))) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {t("delete")}
          </button>
        </div>

        {itemsWithContent.length === 0 ? (
          <p className="mt-12 rounded-xl border border-dashed border-zipo-border-subtle p-12 text-center text-zipo-muted">
            {t("emptyPlaylist")}
          </p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {itemsWithContent.map((entry, index) => (
              <div key={entry.id} className="relative">
                <ContentCard item={entry.content!} index={index} />
                <button
                  type="button"
                  onClick={() =>
                    removeMutation.mutate({
                      contentType: entry.contentType,
                      contentId: entry.contentId,
                    })
                  }
                  disabled={removeMutation.isPending}
                  className="absolute right-2 top-2 rounded-full bg-zipo-bg/90 p-1.5 text-zipo-muted hover:text-red-400"
                  title={t("removeItem")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}

export default function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = use(params);
  return <PlaylistDetailClient id={id} />;
}
