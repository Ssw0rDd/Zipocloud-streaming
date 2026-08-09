"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bell, BellOff, CheckCircle2, Link2Off, Loader2 } from "lucide-react";
import {
  disconnectAnilist,
  fetchAnilistAuthUrl,
  fetchAnilistStatus,
  fetchEpisodeNotificationSubscriptions,
  subscribeEpisodeNotifications,
  unsubscribeEpisodeNotifications,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function AniListConnectBanner() {
  const t = useTranslations("anilist");
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["anilist-status"],
    queryFn: fetchAnilistStatus,
    enabled: isLoggedIn,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { url } = await fetchAnilistAuthUrl();
      window.location.href = url;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectAnilist,
    onSuccess: () => {
      queryClient.setQueryData(["anilist-status"], { connected: false });
      queryClient.invalidateQueries({ queryKey: ["episode-notifications"] });
    },
  });

  if (!isLoggedIn || isLoading) return null;

  if (status?.connected) {
    return (
      <div className="mb-8 flex flex-col gap-4 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-zipo-text">{t("connected")}</p>
            <p className="mt-1 text-sm text-zipo-muted">{t("disconnectHint")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          className="btn-secondary inline-flex min-h-11 shrink-0 items-center justify-center gap-2"
        >
          {disconnectMutation.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Link2Off className="h-4 w-4" />}
          {t("disconnect")}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-xl border border-zipo-border bg-zipo-elevated p-4">
      <p className="text-sm text-zipo-muted">{t("connectHint")}</p>
      <button
        type="button"
        onClick={() => connectMutation.mutate()}
        disabled={connectMutation.isPending}
        className="btn-primary mt-3 inline-flex items-center gap-2"
      >
        {connectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {t("connect")}
      </button>
    </div>
  );
}

interface EpisodeNotifyButtonProps {
  animeId: string;
  className?: string;
}

export function EpisodeNotifyButton({ animeId, className }: EpisodeNotifyButtonProps) {
  const t = useTranslations("anilist");
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const { data: subs, isLoading } = useQuery({
    queryKey: ["episode-notifications"],
    queryFn: fetchEpisodeNotificationSubscriptions,
    enabled: isLoggedIn,
  });

  const subscribed = subs?.subscriptions.includes(animeId) ?? false;

  const toggleMutation = useMutation({
    mutationFn: () =>
      subscribed
        ? unsubscribeEpisodeNotifications(animeId)
        : subscribeEpisodeNotifications(animeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["episode-notifications"] });
    },
  });

  if (!isLoggedIn) return null;

  return (
    <button
      type="button"
      onClick={() => toggleMutation.mutate()}
      disabled={isLoading || toggleMutation.isPending}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-zipo-border px-3 py-2 text-sm text-zipo-text transition-colors hover:border-zipo-accent/50",
        className,
      )}
    >
      {toggleMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : subscribed ? (
        <BellOff className="h-4 w-4" />
      ) : (
        <Bell className="h-4 w-4" />
      )}
      {subscribed ? t("unsubscribe") : t("subscribe")}
    </button>
  );
}
