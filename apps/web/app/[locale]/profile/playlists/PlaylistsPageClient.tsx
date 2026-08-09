"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ListMusic, Loader2, Plus, Trash2 } from "lucide-react";
import {
  createPlaylist,
  deletePlaylist,
  fetchPlaylists,
  renamePlaylist,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-config";
import { useAuth } from "@/hooks/useAuth";
import { PageTransition } from "@/components/ContentRow";
import { AniListConnectBanner } from "@/components/anilist/AniListActions";
import { Skeleton } from "@/components/Skeleton";

export function PlaylistsPageClient() {
  const t = useTranslations("playlists");
  const tc = useTranslations("common");
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.playlists(),
    queryFn: fetchPlaylists,
    enabled: isLoggedIn,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createPlaylist(name),
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renamePlaylist(id, name),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlaylist(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
    },
  });

  if (authLoading) {
    return <Skeleton className="mx-auto mt-24 h-64 max-w-3xl rounded-xl" />;
  }

  if (!isLoggedIn) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <ListMusic className="mx-auto h-12 w-12 text-zipo-muted" />
          <h1 className="mt-4 text-2xl font-semibold text-zipo-text">{t("title")}</h1>
          <p className="mt-2 text-zipo-muted">{t("loginRequired")}</p>
          <Link href="/auth/login" className="btn-primary mt-6 inline-flex">
            {tc("login")}
          </Link>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold text-zipo-text">{t("title")}</h1>
        <AniListConnectBanner />
        <p className="mt-2 text-zipo-muted">{t("subtitle")}</p>

        <form
          className="mt-8 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (name) createMutation.mutate(name);
          }}
        >
          <input
            type="text"
            name="playlist-name"
            autoComplete="off"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("newPlaylistPlaceholder")}
            aria-label={t("newPlaylistPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-zipo-border bg-zipo-bg px-4 py-3 text-sm text-zipo-text outline-none focus:border-zipo-accent"
            maxLength={100}
          />
          <button
            type="submit"
            disabled={createMutation.isPending || !newName.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-zipo-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("create")}
          </button>
        </form>

        <div className="mt-8 space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </>
          ) : data?.data.length ? (
            data.data.map((playlist) => (
              <div
                key={playlist.id}
                className="flex items-center gap-3 rounded-xl border border-zipo-border-subtle bg-zipo-elevated p-4"
              >
                {editingId === playlist.id ? (
                  <form
                    className="flex min-w-0 flex-1 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = editName.trim();
                      if (name) renameMutation.mutate({ id: playlist.id, name });
                    }}
                  >
                    <input
                      type="text"
                      name="playlist-name"
                      autoComplete="off"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-zipo-border bg-zipo-bg px-3 py-2 text-sm"
                      aria-label={t("newPlaylistPlaceholder")}
                    />
                    <button type="submit" className="btn-primary px-3 py-2 text-sm">
                      {t("save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-3 py-2 text-sm text-zipo-muted"
                    >
                      {t("cancel")}
                    </button>
                  </form>
                ) : (
                  <>
                    <Link
                      href={`/profile/playlists/${playlist.id}`}
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate font-medium text-zipo-text">{playlist.name}</p>
                      <p className="text-xs text-zipo-muted">
                        {t("itemCount", { count: playlist.itemCount })}
                      </p>
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(playlist.id);
                        setEditName(playlist.name);
                      }}
                      className="rounded-lg px-3 py-2 text-sm text-zipo-muted hover:text-zipo-text"
                    >
                      {t("rename")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t("deleteConfirm"))) {
                          deleteMutation.mutate(playlist.id);
                        }
                      }}
                      className="rounded-lg p-2 text-zipo-muted hover:text-red-400"
                      title={t("delete")}
                      aria-label={`${t("delete")}: ${playlist.name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-zipo-border-subtle p-8 text-center text-zipo-muted">
              {t("noPlaylists")}
            </p>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
