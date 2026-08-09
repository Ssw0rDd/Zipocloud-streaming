"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ListPlus, Loader2, Plus } from "lucide-react";
import type { ContentType } from "@zipo/shared";
import {
  addToPlaylist,
  createPlaylist,
  fetchPlaylists,
  type PlaylistSummary,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-config";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";

interface AddToPlaylistButtonProps {
  contentType: ContentType;
  contentId: string;
  className?: string;
  variant?: "button" | "icon";
}

export function AddToPlaylistButton({
  contentType,
  contentId,
  className,
  variant = "button",
}: AddToPlaylistButtonProps) {
  const t = useTranslations("playlists");
  const tc = useTranslations("common");
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.playlists(),
    queryFn: fetchPlaylists,
    enabled: isLoggedIn && open,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (playlistId: string) =>
      addToPlaylist(playlistId, contentType, contentId),
    onSuccess: () => {
      setFeedback(t("added"));
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
      setTimeout(() => {
        setOpen(false);
        setFeedback(null);
      }, 1200);
    },
  });

  const handleCreateAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const playlist = await createPlaylist(name);
      queryClient.setQueryData<{ data: PlaylistSummary[] }>(
        queryKeys.playlists(),
        (prev) => ({
          data: [
            {
              id: playlist.id,
              name: playlist.name,
              itemCount: 0,
              createdAt: playlist.createdAt,
              updatedAt: playlist.updatedAt,
            },
            ...(prev?.data ?? []),
          ],
        }),
      );
      await addMutation.mutateAsync(playlist.id);
      setNewName("");
    } finally {
      setCreating(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <p className={cn("text-xs text-zipo-muted", className)}>
        <Link href="/auth/login" className="text-zipo-gold hover:underline">
          {tc("login")}
        </Link>{" "}
        {t("loginToSave")}
      </p>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          variant === "icon"
            ? "flex h-11 w-11 items-center justify-center rounded-lg border border-zipo-border bg-zipo-elevated text-zipo-muted transition-colors hover:border-zipo-accent/40 hover:text-zipo-text"
            : "inline-flex items-center gap-2 rounded-lg border border-zipo-border bg-zipo-elevated px-4 py-2.5 text-sm font-medium text-zipo-text transition-colors hover:border-zipo-accent/40",
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={variant === "icon" ? t("addToPlaylist") : undefined}
      >
        <ListPlus className="h-4 w-4" aria-hidden />
        {variant === "button" && t("addToPlaylist")}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            aria-label={t("closeMenu")}
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-zipo-border-subtle bg-zipo-elevated shadow-xl">
            <div className="border-b border-zipo-border-subtle px-4 py-3">
              <p className="text-sm font-medium text-zipo-text">{t("choosePlaylist")}</p>
            </div>

            <div className="max-h-56 overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-zipo-muted" />
                </div>
              ) : data?.data.length ? (
                data.data.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    disabled={addMutation.isPending}
                    onClick={() => addMutation.mutate(playlist.id)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-zipo-text transition-colors hover:bg-zipo-surface"
                  >
                    <span className="truncate">{playlist.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-zipo-muted">
                      {playlist.itemCount}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-sm text-zipo-muted">{t("emptyList")}</p>
              )}
            </div>

            <div className="border-t border-zipo-border-subtle p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  name="new-playlist-name"
                  autoComplete="off"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("newPlaylistPlaceholder")}
                  aria-label={t("newPlaylistPlaceholder")}
                  className="min-w-0 flex-1 rounded-lg border border-zipo-border bg-zipo-bg px-3 py-2 text-sm text-zipo-text outline-none focus:border-zipo-accent"
                  maxLength={100}
                />
                <button
                  type="button"
                  onClick={handleCreateAndAdd}
                  disabled={creating || !newName.trim() || addMutation.isPending}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-zipo-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("create")}
                </button>
              </div>
            </div>

            {feedback && (
              <p className="border-t border-zipo-border-subtle px-4 py-2 text-xs text-zipo-accent">
                {feedback}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
