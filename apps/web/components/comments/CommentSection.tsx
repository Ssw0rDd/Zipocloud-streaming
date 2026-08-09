"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sanitizePlainText } from "@/lib/sanitize";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  LogIn,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import {
  deleteComment,
  fetchComments,
  postComment,
} from "@/lib/api";
import type { ContentType } from "@/lib/api";
import { isValidContentId } from "@zipo/shared";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/Skeleton";

interface CommentSectionProps {
  contentType: Extract<ContentType, "anime" | "series">;
  contentId: string;
  episodeNumber?: number;
}

function isValidCommentTarget(
  contentType: Extract<ContentType, "anime" | "series">,
  contentId: string,
): boolean {
  if (!contentId.trim()) return false;
  if (contentType === "anime") {
    const numericId = Number(contentId);
    return Number.isFinite(numericId) && numericId > 0;
  }
  return isValidContentId("series", contentId);
}

export function CommentSection({
  contentType,
  contentId,
  episodeNumber,
}: CommentSectionProps) {
  const t = useTranslations("detail");
  const tc = useTranslations("common");
  const { user, isLoggedIn, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const queryKey = ["comments", contentType, contentId] as const;
  const enabled = isValidCommentTarget(contentType, contentId);

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchComments(contentType, contentId, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.hasMore && last.nextCursor ? last.nextCursor : undefined,
    enabled,
  });

  const comments = data?.pages.flatMap((p) => p.data) ?? [];

  const mutation = useMutation({
    mutationFn: (text: string) =>
      postComment(contentType, contentId, text, episodeNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setBody("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn) return;
    const sanitized = sanitizePlainText(body);
    if (!sanitized) return;
    mutation.mutate(sanitized);
  };

  if (!enabled) {
    return null;
  }

  return (
    <section className="mt-12">
      <h2 className="flex items-center gap-2 font-display text-2xl tracking-wide text-white">
        <MessageSquare className="h-6 w-6 text-zipo-red" aria-hidden />
        {t("comments")}
      </h2>

      {authLoading ? (
        <Skeleton className="mt-6 h-12 w-full" />
      ) : isLoggedIn ? (
        <form onSubmit={handleSubmit} className="mt-6 flex gap-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("addComment")}
            maxLength={2000}
            rows={2}
            disabled={mutation.isPending}
            className="flex-1 resize-none rounded-lg border border-zipo-border bg-zipo-elevated px-4 py-3 text-sm text-zipo-text placeholder:text-zipo-muted focus:border-zipo-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={!body.trim() || mutation.isPending}
            className="flex shrink-0 items-center gap-2 self-end rounded-lg bg-zipo-accent px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-zipo-accent-hover disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            {t("submitComment")}
          </button>
        </form>
      ) : (
        <p className="mt-6 flex items-center gap-2 text-sm text-zipo-muted">
          <LogIn className="h-4 w-4 shrink-0" aria-hidden />
          {t("loginToComment")}{" "}
          <Link href="/auth/login" className="font-medium text-zipo-gold hover:underline">
            {tc("login")}
          </Link>
        </p>
      )}

      {mutation.isError && (
        <p className="mt-3 text-sm text-zipo-red">{t("commentError")}</p>
      )}

      <div className="mt-8 space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : comments.length > 0 ? (
          comments.map((comment, i) => (
            <motion.div
              key={comment.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-lg border border-zipo-border bg-zipo-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zipo-red/20 text-xs font-bold text-zipo-red">
                    {sanitizePlainText(comment.userName)[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zipo-text">
                      {sanitizePlainText(comment.userName)}
                    </p>
                    <p className="text-xs text-zipo-muted">
                      {new Date(comment.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {user?.id === comment.userId && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(comment.id)}
                    disabled={deleteMutation.isPending}
                    className="rounded p-1.5 text-zipo-muted transition-colors hover:bg-zipo-elevated hover:text-zipo-red"
                    aria-label={t("deleteComment")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-3 text-sm text-zipo-muted">
                {sanitizePlainText(comment.body)}
              </p>
            </motion.div>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-zipo-muted">
            {t("noComments")}
          </p>
        )}
      </div>

      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-zipo-border py-2.5 text-sm text-zipo-muted transition-colors hover:border-zipo-red/40 hover:text-zipo-text"
        >
          {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("loadMoreComments")}
        </button>
      )}
    </section>
  );
}

/** @deprecated Use CommentSection with contentType="anime" */
export function AnimeCommentSection({
  animeId,
  episodeNumber,
}: {
  animeId: string;
  episodeNumber?: number;
}) {
  return (
    <CommentSection
      contentType="anime"
      contentId={animeId}
      episodeNumber={episodeNumber}
    />
  );
}
