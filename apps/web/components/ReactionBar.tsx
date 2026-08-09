"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { ContentType } from "@zipo/shared";
import { fetchReactions, setReaction, type ReactionType } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/routing";

interface ReactionBarProps {
  contentType: ContentType;
  contentId: string;
  className?: string;
}

export function ReactionBar({ contentType, contentId, className }: ReactionBarProps) {
  const t = useTranslations("reactions");
  const tc = useTranslations("common");
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["reactions", contentType, contentId],
    queryFn: () => fetchReactions(contentType, contentId),
    retry: false,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (reaction: ReactionType | null) =>
      setReaction(contentType, contentId, reaction),
    onSuccess: (result) => {
      queryClient.setQueryData(["reactions", contentType, contentId], result);
    },
  });

  const handleReaction = (reaction: ReactionType) => {
    if (!isLoggedIn) return;
    const next = data?.userReaction === reaction ? null : reaction;
    mutation.mutate(next);
  };

  if (isError) {
    return null;
  }

  const likes = data?.likes ?? 0;
  const dislikes = data?.dislikes ?? 0;
  const userReaction = data?.userReaction ?? null;

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleReaction("like")}
          disabled={!isLoggedIn || isLoading || mutation.isPending}
          title={isLoggedIn ? t("like") : t("loginRequired")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
            userReaction === "like"
              ? "border-zipo-red/50 bg-zipo-red/20 text-zipo-red"
              : "border-zipo-border bg-zipo-elevated text-zipo-muted hover:border-zipo-red/30 hover:text-zipo-text",
            !isLoggedIn && "cursor-not-allowed opacity-60",
          )}
        >
          <ThumbsUp className="h-4 w-4" aria-hidden />
          <span>{likes}</span>
        </button>
        <button
          type="button"
          onClick={() => handleReaction("dislike")}
          disabled={!isLoggedIn || isLoading || mutation.isPending}
          title={isLoggedIn ? t("dislike") : t("loginRequired")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
            userReaction === "dislike"
              ? "border-zipo-gold/50 bg-zipo-gold/20 text-zipo-gold"
              : "border-zipo-border bg-zipo-elevated text-zipo-muted hover:border-zipo-gold/30 hover:text-zipo-text",
            !isLoggedIn && "cursor-not-allowed opacity-60",
          )}
        >
          <ThumbsDown className="h-4 w-4" aria-hidden />
          <span>{dislikes}</span>
        </button>
      </div>
      {!isLoggedIn && (
        <p className="text-xs text-zipo-muted">
          <Link href="/auth/login" className="text-zipo-gold hover:underline">
            {tc("login")}
          </Link>{" "}
          {t("toReact")}
        </p>
      )}
    </div>
  );
}
