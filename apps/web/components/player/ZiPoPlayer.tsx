"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import {
  List,
  Loader2,
  Maximize,
  Minimize,
  Monitor,
  RefreshCw,
  Scissors,
  SkipBack,
  SkipForward,
} from "lucide-react";
import {
  apiFetch,
  createPlaybackBootstrap,
  fetchPlaybackEmbeds,
  fetchPlaybackPreparation,
  refreshPlaybackSession,
  reportPlaybackIssue,
  selectPlaybackServer,
} from "@/lib/api";
import { ApiClientError } from "@/lib/api-client";
import type {
  PlaybackBootstrap,
  PlaybackIssueCode,
  PlaybackSession,
  SecureEmbedPlayback,
} from "@zipo/shared";
import { cn } from "@/lib/utils";
import { EpisodeDrawer } from "./EpisodeDrawer";
import { NativePlayerControls } from "./NativePlayerControls";
import { PlayerErrorState } from "./PlayerErrorState";
import { PlayerOverlayAd } from "./PlayerOverlayAd";
import type {
  EmbedSource,
  PlaybackProviderInfo,
  PlayerModeCapabilities,
  ZiPoPlayerHandle,
  ZiPoPlayerProps,
} from "./types";
import { isSafePlayerUrl } from "./utils";

const LOADING_CAPABILITIES: PlayerModeCapabilities = {
  mode: "loading",
  canControlMedia: false,
  canTrackProgress: false,
  canResume: false,
  canCreateClips: false,
  canOpenCinema: false,
  canAutoplayNext: false,
};

const EMBED_CAPABILITIES: PlayerModeCapabilities = {
  mode: "embed",
  canControlMedia: false,
  canTrackProgress: false,
  canResume: false,
  canCreateClips: false,
  canOpenCinema: false,
  canAutoplayNext: false,
};

function playerOrdinalLabel(index: number): string {
  return `Player ${index + 1}`;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function awaitPreparedPlayback(
  initial: PlaybackBootstrap,
  signal?: AbortSignal,
): Promise<PlaybackBootstrap> {
  let current = initial;
  const deadline = Date.now() + 5 * 60_000;
  while (current.mode === "preparing" && Date.now() < deadline) {
    await wait((current.preparation.retryAfterSeconds ?? 2) * 1_000, signal);
    current = await fetchPlaybackPreparation(current.preparation.id, { signal });
  }
  return current;
}

interface PlayerIssue {
  code: PlaybackIssueCode;
  message: string;
}

function playbackIssue(error: unknown, fallback: string): PlayerIssue {
  if (error instanceof ApiClientError) {
    const knownCodes: PlaybackIssueCode[] = [
      "PLAYBACK_UNAVAILABLE",
      "SESSION_EXPIRED",
      "ADULT_LOGIN_REQUIRED",
      "RATE_LIMIT_EXCEEDED",
    ];
    return {
      code: knownCodes.includes(error.code as PlaybackIssueCode)
        ? error.code as PlaybackIssueCode
        : error.status >= 500
          ? "PLAYBACK_FAILED"
          : "INVALID_RESPONSE",
      message: error.message,
    };
  }
  if (error instanceof TypeError) return { code: "NETWORK_ERROR", message: fallback };
  return { code: "PLAYBACK_FAILED", message: fallback };
}

export const ZiPoPlayer = forwardRef<ZiPoPlayerHandle, ZiPoPlayerProps>(
  function ZiPoPlayer(
    {
      contentType,
      contentId,
      episodeId,
      episodeNumber,
      episodeSeason,
      title,
      isAdult = false,
      className,
      startTime,
      endTime,
      autoPlay = false,
      onTimeUpdate,
      onDurationChange,
      onPause,
      onPlay,
      onSeek,
      onPlaybackRateChange,
      onServerChange,
      onReady,
      clipEnabled = false,
      onClipClick,
      theaterMode = false,
      onTheaterToggle,
      showEpisodesButton = false,
      onEpisodesClick,
      episodes,
      onEpisodeSelect,
      hasPrevEpisode = false,
      onPrevEpisode,
      hasNextEpisode = false,
      onNextEpisode,
      episodesInSidebar = false,
      onEnded,
      preferredProviderId,
      onShowTrailer,
      onBackToDetails,
      syncControlled = false,
      variant = "watch",
      cinemaHost = false,
      cinemaViewerCount,
      onCapabilitiesChange,
    },
    ref,
  ) {
    const isCinema = variant === "cinema";
    const t = useTranslations("player");
    const tc = useTranslations("common");
    const shellRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const failedSourceUrlsRef = useRef(new Set<string>());
    const hlsRef = useRef<import("hls.js").default | null>(null);
    const providerRequestRef = useRef<AbortController | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const automaticRetryRef = useRef(0);
    const hlsNetworkRecoveryRef = useRef(0);
    const hlsMediaRecoveryRef = useRef(0);
    const hlsSessionRefreshRef = useRef(0);
    const sessionRefreshTimerRef = useRef<number | null>(null);
    const [source, setSource] = useState<EmbedSource | null>(null);
    const [secureEmbed, setSecureEmbed] = useState<SecureEmbedPlayback | null>(null);
    const [secureEmbeds, setSecureEmbeds] = useState<SecureEmbedPlayback[]>([]);
    const [providers, setProviders] = useState<PlaybackProviderInfo[]>([]);
    const [playbackSession, setPlaybackSession] = useState<PlaybackSession | null>(null);
    const [prerollActive, setPrerollActive] = useState(false);
    const [prerollCanSkip, setPrerollCanSkip] = useState(false);
    const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<PlayerIssue | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false);
    const [retryToken, setRetryToken] = useState(0);
    const [nextCountdown, setNextCountdown] = useState<number | null>(null);
    const [sourceResumeTime, setSourceResumeTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [qualityLevels, setQualityLevels] = useState<Array<{ value: number; label: string }>>([
      { value: -1, label: t("auto") },
    ]);
    const [selectedQuality, setSelectedQuality] = useState(-1);

    const mode = source?.type === "hls" || source?.type === "mp4"
      ? "native"
      : secureEmbed
        ? "embed"
        : "loading";

    const activeNativeServer = useMemo(() => {
      if (!source || (source.type !== "hls" && source.type !== "mp4")) return null;
      // Bootstrap maps `providerId` to the session server id (server-1, …).
      return (
        playbackSession?.servers.find((server) => server.id === source.providerId) ??
        playbackSession?.servers.find((server) => server.selected) ??
        null
      );
    }, [playbackSession, source]);

    const capabilities = useMemo<PlayerModeCapabilities>(() => {
      if (mode === "native") {
        // Clips + full Cinema only when native Player 1 is MegaFrix HLS (.m3u8).
        const canCreateClips =
          source?.type === "hls" &&
          activeNativeServer != null &&
          activeNativeServer.id === "server-1" &&
          activeNativeServer.type === "hls" &&
          activeNativeServer.providerId === "megafrix";
        return {
          mode,
          canControlMedia: true,
          canTrackProgress: true,
          canResume: true,
          canCreateClips,
          canOpenCinema: canCreateClips,
          canAutoplayNext: true,
        };
      }
      if (mode === "embed") return EMBED_CAPABILITIES;
      return LOADING_CAPABILITIES;
    }, [mode, source?.type, activeNativeServer]);

    const nativeServers = useMemo(
      () => playbackSession?.servers.map((server, index) => ({
        type: server.type,
        url: server.id,
        label: playerOrdinalLabel(index),
        quality: server.quality,
        providerId: server.id,
        textTracks: server.subtitles,
        capabilities: {
          mode: "native" as const,
          handoffToProvider: false,
          supportsQualitySwitch: server.type === "hls",
          supportsAutoFallback: true,
        },
      })) ?? [],
      [playbackSession],
    );

    const switchSource = useCallback((nextSource: EmbedSource) => {
      if (nextSource.type !== "hls" && nextSource.type !== "mp4") {
        setError({ code: "INVALID_RESPONSE", message: t("playbackError") });
        setLoading(false);
        return;
      }
      const nativeTime = videoRef.current?.currentTime;
      const handoffTime = nativeTime && Number.isFinite(nativeTime) ? nativeTime : 0;
      setSourceResumeTime(Math.max(0, handoffTime || 0));
      setError(null);
      setLoading(true);
      setSource(nextSource);
    }, [t]);

    useEffect(() => {
      onCapabilitiesChange?.(capabilities);
    }, [capabilities, onCapabilitiesChange]);

    const requestedEpisode =
      episodeNumber != null && Number.isSafeInteger(episodeNumber) && episodeNumber > 0
        ? episodeNumber
        : contentType === "movie"
          ? undefined
          : 1;

    const loadSource = useCallback(async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      setSource(null);
      setSecureEmbed(null);
      setSecureEmbeds([]);
      setPlaybackSession(null);
      setProviders([]);
      failedSourceUrlsRef.current.clear();
      setSourceResumeTime(Math.max(0, startTime ?? 0));
      try {
        const playbackRequest = {
          contentType,
          contentId,
          episodeId,
          season: episodeSeason,
          episode: requestedEpisode,
          preferredServerId: preferredProviderId,
        };
        const initial = await createPlaybackBootstrap(playbackRequest, { signal });
        const bootstrap = await awaitPreparedPlayback(initial, signal);
        if (signal?.aborted) return;
        if (bootstrap.mode === "embed") {
          const embedOptions = (bootstrap.embeds?.length
            ? bootstrap.embeds
            : [bootstrap.embed]
          ).filter(
            (embed, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate.providerId === embed.providerId || candidate.url === embed.url,
              ) === index,
          );
          const activeEmbed = embedOptions[0] ?? bootstrap.embed;
          setSecureEmbeds(embedOptions);
          setProviders(embedOptions.map((embed, index) => ({
            id: embed.providerId,
            label: playerOrdinalLabel(index),
            available: true,
          })));
          setSecureEmbed(activeEmbed);
          setSource(null);
          if (bootstrap.preroll) {
            setPlaybackSession({
              id: "secure-embed",
              sessionToken: "none",
              contentType,
              contentId,
              selectedServerId: activeEmbed.providerId,
              servers: [],
              streamUrl: activeEmbed.url,
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              preroll: bootstrap.preroll,
            });
            setPrerollActive(true);
            setPrerollCanSkip(false);
            window.setTimeout(
              () => setPrerollCanSkip(true),
              bootstrap.preroll.skipAfterSeconds * 1_000,
            );
            void apiFetch("/api/v1/ads/impression", {
              method: "POST",
              body: JSON.stringify({
                adUnitId: bootstrap.preroll.impressionId,
                tier: "free",
                placement: "preroll",
                contentType,
                contentId,
              }),
            }).catch(() => undefined);
          } else {
            setPlaybackSession(null);
            setPrerollActive(false);
          }
          setLoading(false);
          return;
        }
        if (bootstrap.mode === "unavailable") {
          setError({
            code: bootstrap.code,
            message: bootstrap.reason === "NO_SAFE_SOURCE"
              ? "Nenhuma fonte segura compatível foi encontrada."
              : "Nenhuma fonte nativa foi encontrada.",
          });
          setLoading(false);
          return;
        }
        if (bootstrap.mode === "preparing") {
          setError({
            code: "PLAYBACK_UNAVAILABLE",
            message: "A preparação da mídia excedeu o tempo de espera.",
          });
          setLoading(false);
          return;
        }
        const response = bootstrap.session;
        if (!isSafePlayerUrl(response.streamUrl)) {
          setError({ code: "INVALID_RESPONSE", message: t("playbackError") });
          setLoading(false);
          return;
        }
        const selectedServer = response.servers.find((server) => server.selected);
        const selected: EmbedSource = {
          type: selectedServer?.type ?? "hls",
          url: response.streamUrl,
          label: selectedServer?.label,
          quality: selectedServer?.quality,
          providerId: response.selectedServerId,
          textTracks: selectedServer?.subtitles,
          capabilities: {
            mode: "native",
            handoffToProvider: false,
            supportsQualitySwitch: selectedServer?.type === "hls",
            supportsAutoFallback: true,
          },
        };
        setPlaybackSession(response);
        setSecureEmbeds([]);
        setSecureEmbed(null);
        setProviders(response.servers.map((server, index) => ({
          id: server.id,
          label: playerOrdinalLabel(index),
          available: server.available,
        })));
        setSource(selected);
        setPrerollActive(Boolean(response.preroll));
        setPrerollCanSkip(false);
        void fetchPlaybackEmbeds(playbackRequest, { signal })
          .then(({ embeds }) => {
            if (signal?.aborted || embeds.length === 0) return;
            const uniqueEmbeds = embeds.filter(
              (embed, index, all) =>
                all.findIndex(
                  (candidate) =>
                    candidate.providerId === embed.providerId || candidate.url === embed.url,
                ) === index,
            );
            setSecureEmbeds(uniqueEmbeds);
            setProviders((current) => {
              const extras = uniqueEmbeds.filter(
                (embed) => !current.some((provider) => provider.id === embed.providerId),
              );
              return [
                ...current,
                ...extras.map((embed, index) => ({
                  id: embed.providerId,
                  label: playerOrdinalLabel(current.length + index),
                  available: true,
                })),
              ];
            });
          })
          .catch(() => undefined);
        if (response.preroll) {
          window.setTimeout(() => setPrerollCanSkip(true), response.preroll.skipAfterSeconds * 1_000);
          void apiFetch("/api/v1/ads/impression", {
            method: "POST",
            body: JSON.stringify({
              adUnitId: response.preroll.impressionId,
              tier: "free",
              placement: "preroll",
              contentType,
              contentId,
            }),
          }).catch(() => undefined);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        const issue = playbackIssue(loadError, t("playbackError"));
        const retryable = issue.code === "NETWORK_ERROR" || issue.code === "PLAYBACK_FAILED";
        if (retryable && automaticRetryRef.current < 1 && !signal?.aborted) {
          automaticRetryRef.current += 1;
          setLoading(true);
          retryTimerRef.current = setTimeout(() => setRetryToken((value) => value + 1), 700);
          return;
        }
        setError(issue);
        setLoading(false);
      }
    }, [
      contentId,
      contentType,
      episodeId,
      episodeSeason,
      preferredProviderId,
      requestedEpisode,
      startTime,
      t,
    ]);

    useEffect(() => {
      const controller = new AbortController();
      void loadSource(controller.signal);
      return () => {
        controller.abort();
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      };
    }, [loadSource, retryToken]);

    useEffect(() => {
      automaticRetryRef.current = 0;
    }, [contentId, contentType, episodeId, episodeSeason, requestedEpisode]);

    useEffect(() => () => providerRequestRef.current?.abort(), []);

    const activateProvider = useCallback(
      async (providerId: string) => {
        const nextEmbed = secureEmbeds.find(
          (embed) => embed.providerId === providerId,
        );
        if (nextEmbed) {
          failedSourceUrlsRef.current.delete(providerId);
          setLoadingProviderId(providerId);
          setError(null);
          setLoading(true);
          setSource(null);
          setPrerollActive(false);
          setSecureEmbed(nextEmbed);
          setLoadingProviderId(null);
          onServerChange?.(providerId);
          return;
        }
        if (!playbackSession) return;
        providerRequestRef.current?.abort();
        const controller = new AbortController();
        providerRequestRef.current = controller;
        setLoadingProviderId(providerId);
        setError(null);
        setLoading(true);
        try {
          const nextSession = await selectPlaybackServer(
            playbackSession.id,
            playbackSession.sessionToken,
            providerId,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (!isSafePlayerUrl(nextSession.streamUrl)) {
            setError({ code: "INVALID_RESPONSE", message: t("playbackError") });
            setLoading(false);
            return;
          }
          const server = nextSession.servers.find((item) => item.selected);
          const selected: EmbedSource = {
            type: server?.type ?? "hls",
            url: nextSession.streamUrl,
            label: server?.label,
            quality: server?.quality,
            providerId,
            textTracks: server?.subtitles,
            capabilities: {
              mode: "native",
              handoffToProvider: false,
              supportsQualitySwitch: server?.type === "hls",
              supportsAutoFallback: true,
            },
          };
          setPlaybackSession(nextSession);
          switchSource(selected);
          onServerChange?.(providerId);
        } catch (providerError) {
          if (providerError instanceof DOMException && providerError.name === "AbortError") return;
          setError(playbackIssue(providerError, t("playbackError")));
          setLoading(false);
        } finally {
          if (!controller.signal.aborted) {
            setLoadingProviderId(null);
          }
        }
      },
      [onServerChange, playbackSession, secureEmbeds, switchSource, t],
    );

    const renewNativeSession = useCallback(async (): Promise<boolean> => {
      const current = playbackSession;
      if (!current || current.id === "secure-embed") return false;
      try {
        const nextSession = await refreshPlaybackSession(
          current.id,
          current.sessionToken,
        );
        const server = nextSession.servers.find((item) => item.selected);
        if (!server || !isSafePlayerUrl(nextSession.streamUrl)) return false;
        setPlaybackSession(nextSession);
        setProviders((existing) => [
          ...nextSession.servers.map((entry, index) => ({
            id: entry.id,
            label: playerOrdinalLabel(index),
            available: entry.available,
          })),
          ...existing.filter((entry) => !entry.id.startsWith("server-")),
        ]);
        switchSource({
          type: server.type,
          url: nextSession.streamUrl,
          label: server.label,
          quality: server.quality,
          providerId: server.id,
          textTracks: server.subtitles,
          capabilities: {
            mode: "native",
            handoffToProvider: false,
            supportsQualitySwitch: server.type === "hls",
            supportsAutoFallback: true,
          },
        });
        return true;
      } catch {
        return false;
      }
    }, [playbackSession, switchSource]);

    useEffect(() => {
      if (sessionRefreshTimerRef.current) {
        window.clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = null;
      }
      if (!playbackSession || playbackSession.id === "secure-embed" || mode !== "native") return;
      const expiresAt = Date.parse(playbackSession.expiresAt);
      if (!Number.isFinite(expiresAt)) return;
      const delay = Math.max(10_000, expiresAt - Date.now() - 60_000);
      sessionRefreshTimerRef.current = window.setTimeout(() => {
        void renewNativeSession();
      }, delay);
      return () => {
        if (sessionRefreshTimerRef.current) {
          window.clearTimeout(sessionRefreshTimerRef.current);
          sessionRefreshTimerRef.current = null;
        }
      };
    }, [mode, playbackSession, renewNativeSession]);

    const availableProviders = useMemo(
      () => providers.filter((provider) => provider.available),
      [providers],
    );
    const activePlayerId = source?.providerId ?? secureEmbed?.providerId;
    const activePlayerLabel = availableProviders.find(
      (provider) => provider.id === activePlayerId,
    )?.label;

    const cyclePlayer = useCallback(() => {
      if (availableProviders.length < 2) return;
      const currentIndex = availableProviders.findIndex(
        (provider) => provider.id === activePlayerId,
      );
      const next = availableProviders[(currentIndex + 1) % availableProviders.length];
      if (!next) return;
      failedSourceUrlsRef.current.delete(next.id);
      void activateProvider(next.id);
    }, [activateProvider, activePlayerId, availableProviders]);

    useEffect(() => {
      const listener = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
      document.addEventListener("fullscreenchange", listener);
      return () => document.removeEventListener("fullscreenchange", listener);
    }, []);

    const failNativeSource = useCallback(() => {
      const currentId = source?.providerId;
      if (currentId) failedSourceUrlsRef.current.add(currentId);
      void reportPlaybackIssue({
        contentType,
        contentId,
        episodeId,
        season: episodeSeason,
        episode: requestedEpisode,
        code: "PLAYBACK_FAILED",
        providerId: playbackSession?.servers.find((server) => server.id === currentId)?.providerId,
      }).catch(() => undefined);
      const fallback = nativeServers.find(
        (item) => item.providerId !== currentId && !failedSourceUrlsRef.current.has(item.providerId ?? ""),
      );
      if (fallback?.providerId) void activateProvider(fallback.providerId);
      else {
        const embedFallback = secureEmbeds.find(
          (embed) => !failedSourceUrlsRef.current.has(embed.providerId),
        );
        if (embedFallback) void activateProvider(embedFallback.providerId);
        else setError({ code: "PLAYBACK_FAILED", message: t("playbackError") });
      }
    }, [
      activateProvider,
      contentId,
      contentType,
      episodeId,
      episodeSeason,
      nativeServers,
      playbackSession,
      requestedEpisode,
      secureEmbeds,
      source?.providerId,
      t,
    ]);

    const failSecureEmbed = useCallback(() => {
      const currentId = secureEmbed?.providerId;
      if (currentId) failedSourceUrlsRef.current.add(currentId);
      const fallback = secureEmbeds.find(
        (embed) =>
          embed.providerId !== currentId &&
          !failedSourceUrlsRef.current.has(embed.providerId),
      );
      if (fallback) {
        void activateProvider(fallback.providerId);
        return;
      }
      const nativeFallback = nativeServers.find(
        (server) =>
          server.providerId != null &&
          !failedSourceUrlsRef.current.has(server.providerId),
      );
      if (nativeFallback?.providerId) {
        void activateProvider(nativeFallback.providerId);
        return;
      }
      setLoading(false);
      setError({
        code: "PLAYBACK_FAILED",
        message: "Nenhum dos players protegidos respondeu.",
      });
    }, [activateProvider, nativeServers, secureEmbed?.providerId, secureEmbeds]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || mode !== "native" || source?.type !== "hls") return;
      hlsNetworkRecoveryRef.current = 0;
      hlsMediaRecoveryRef.current = 0;
      hlsSessionRefreshRef.current = 0;
      setQualityLevels([{ value: -1, label: t("auto") }]);
      setSelectedQuality(-1);
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source.url;
        return;
      }
      let cancelled = false;
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (!Hls.isSupported()) {
          videoRef.current.src = source.url;
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 500,
          fragLoadingMaxRetryTimeout: 8_000,
          backBufferLength: 90,
          maxBufferHole: 0.5,
        });
        hlsRef.current = hls;
        hls.loadSource(source.url);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const levels = hls.levels.map((level, index) => ({
            value: index,
            label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)} kbps`,
          }));
          setQualityLevels([
            { value: -1, label: t("auto") },
            ...levels.filter(
              (level, index, all) => all.findIndex((item) => item.label === level.label) === index,
            ),
          ]);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (
            data.type === Hls.ErrorTypes.NETWORK_ERROR &&
            hlsNetworkRecoveryRef.current < 2
          ) {
            hlsNetworkRecoveryRef.current += 1;
            window.setTimeout(
              () => hls.startLoad(),
              500 * hlsNetworkRecoveryRef.current,
            );
            return;
          }
          if (
            data.type === Hls.ErrorTypes.MEDIA_ERROR &&
            hlsMediaRecoveryRef.current < 2
          ) {
            hlsMediaRecoveryRef.current += 1;
            hls.recoverMediaError();
            return;
          }
          if (hlsSessionRefreshRef.current < 1) {
            hlsSessionRefreshRef.current += 1;
            void renewNativeSession().then((renewed) => {
              if (!renewed) failNativeSource();
            });
            return;
          }
          failNativeSource();
        });
      });
      return () => {
        cancelled = true;
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    }, [failNativeSource, mode, renewNativeSession, source, t]);

    useEffect(() => {
      if (mode === "native" && source?.type === "mp4") {
        setQualityLevels([{ value: -1, label: t("auto") }]);
        setSelectedQuality(-1);
      }
    }, [mode, source?.type, t]);

    useEffect(() => {
      if (nextCountdown == null) return;
      if (nextCountdown <= 0) {
        setNextCountdown(null);
        onNextEpisode?.();
        return;
      }
      const timer = window.setTimeout(
        () => setNextCountdown((value) => (value == null ? null : value - 1)),
        1_000,
      );
      return () => window.clearTimeout(timer);
    }, [nextCountdown, onNextEpisode]);

    const toggleFullscreen = useCallback(async () => {
      if (!shellRef.current) return;
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current.requestFullscreen();
    }, []);

    const togglePlay = useCallback(() => {
      if (syncControlled) return;
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) void video.play();
      else video.pause();
    }, [syncControlled]);

    const seekNative = useCallback((seconds: number) => {
      if (syncControlled) return;
      const video = videoRef.current;
      if (!video || !Number.isFinite(seconds)) return;
      const max = Number.isFinite(video.duration) ? video.duration : seconds;
      video.currentTime = Math.min(max, Math.max(0, seconds));
      setCurrentTime(video.currentTime);
      onSeek?.(video.currentTime);
    }, [onSeek, syncControlled]);

    const changeVolume = useCallback((nextVolume: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(nextVolume)) return;
      video.volume = Math.min(1, Math.max(0, nextVolume));
      video.muted = video.volume === 0;
      setVolume(video.volume);
      setMuted(video.muted);
    }, []);

    const toggleMute = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      video.muted = !video.muted;
      setMuted(video.muted);
    }, []);

    const changePlaybackRate = useCallback((rate: number) => {
      if (syncControlled) return;
      const video = videoRef.current;
      if (!video || !Number.isFinite(rate)) return;
      video.playbackRate = rate;
      setPlaybackRate(rate);
      onPlaybackRateChange?.(rate);
    }, [onPlaybackRateChange, syncControlled]);

    const changeQuality = useCallback((level: number) => {
      if (!Number.isInteger(level)) return;
      if (hlsRef.current) hlsRef.current.currentLevel = level;
      setSelectedQuality(level);
    }, []);

    const togglePictureInPicture = useCallback(async () => {
      const video = videoRef.current;
      if (!video || !document.pictureInPictureEnabled) return;
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch {
        /* Browser or upstream may reject PiP. */
      }
    }, []);

    useEffect(() => {
      if (mode !== "native") return;
      const listener = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, select, textarea, button, [contenteditable='true']")) return;
        if (!shellRef.current?.contains(document.activeElement) && document.fullscreenElement !== shellRef.current) return;
        if ([" ", "k", "K"].includes(event.key)) {
          event.preventDefault();
          togglePlay();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          seekNative((videoRef.current?.currentTime ?? 0) - 10);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          seekNative((videoRef.current?.currentTime ?? 0) + 10);
        } else if (["m", "M"].includes(event.key)) {
          toggleMute();
        } else if (["f", "F"].includes(event.key)) {
          void toggleFullscreen();
        }
      };
      window.addEventListener("keydown", listener);
      return () => window.removeEventListener("keydown", listener);
    }, [mode, seekNative, toggleFullscreen, toggleMute, togglePlay]);

    useImperativeHandle(
      ref,
      () => ({
        getCurrentTime: () => videoRef.current?.currentTime ?? 0,
        getDuration: () => videoRef.current?.duration ?? 0,
        seekTo: (seconds) => {
          if (videoRef.current && Number.isFinite(seconds)) {
            videoRef.current.currentTime = Math.max(0, seconds);
          }
        },
        play: () => {
          if (videoRef.current) void videoRef.current.play();
        },
        pause: () => videoRef.current?.pause(),
        setPlaybackRate: (rate) => {
          if (!videoRef.current || !Number.isFinite(rate)) return;
          videoRef.current.playbackRate = rate;
          setPlaybackRate(rate);
        },
        getPlaybackRate: () => videoRef.current?.playbackRate ?? 1,
        captureFrame: () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
          const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) return null;
          try {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/jpeg", 0.82);
          } catch {
            return null;
          }
        },
      }),
      [],
    );

    const openEpisodes = () => {
      if (onEpisodesClick) onEpisodesClick();
      else setEpisodeDrawerOpen(true);
    };
    const canShowEpisodes =
      !episodesInSidebar &&
      (showEpisodesButton || Boolean(episodes?.length && onEpisodeSelect));

    const utilityBar = (
      <div
        className={cn(
          "flex min-h-12 items-center justify-between gap-3 border-b px-3 sm:min-h-14 sm:px-4",
          isCinema
            ? "border-amber-400/25 bg-gradient-to-r from-[#161210] via-[#12100e] to-[#0f1410]"
            : "border-white/10 bg-[#121412]",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isCinema ? (
              <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-amber-400/15 px-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                Cinema
              </span>
            ) : (
              <span className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zipo-accent text-[10px] font-extrabold tracking-wide text-[#0f1410] sm:inline-flex">
                Z
              </span>
            )}
            <p className="truncate text-sm font-semibold tracking-tight text-[#f2f5f1]">{title ?? t("playerTitle")}</p>
            {isCinema && cinemaHost && (
              <span className="hidden shrink-0 rounded bg-zipo-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zipo-accent sm:inline">
                Host
              </span>
            )}
            {isCinema && !cinemaHost && (
              <span className="hidden shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70 sm:inline">
                Ao vivo
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-white/50" aria-live="polite">
            {isCinema
              ? cinemaHost
                ? "Você controla a sala pelo player"
                : "Sincronizado com o host"
              : (activePlayerLabel ?? (loading ? t("loadingEpisode") : t("playerTitle")))}
            {!loading && !error && !isCinema && (
              <span className="inline-flex items-center gap-1.5 text-zipo-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-zipo-accent" aria-hidden="true" />
                {t("online")}
              </span>
            )}
            {isCinema && typeof cinemaViewerCount === "number" && cinemaViewerCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-300/90">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                {cinemaViewerCount} na sala
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {!isCinema && availableProviders.length > 1 && activePlayerId && (
            <select
              aria-label={t("selectProvider")}
              value={activePlayerId}
              disabled={loadingProviderId != null || syncControlled}
              onChange={(event) => {
                void activateProvider(event.target.value);
              }}
              className="mr-1 min-h-10 max-w-[7.5rem] rounded-lg border border-white/15 bg-[#1a1d1a] px-2 text-xs text-[#f2f5f1] outline-none transition-colors hover:border-zipo-accent/50 focus:border-zipo-accent focus:ring-2 focus:ring-zipo-accent/30 sm:min-h-11 sm:max-w-[9rem]"
            >
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          )}
          {!isCinema && hasPrevEpisode && onPrevEpisode && (
            <button type="button" onClick={onPrevEpisode} className="player-utility-button" aria-label={t("prevEpisode")}>
              <SkipBack className="h-4 w-4" />
            </button>
          )}
          {!isCinema && hasNextEpisode && onNextEpisode && (
            <button type="button" onClick={onNextEpisode} className="player-utility-button" aria-label={t("nextEpisode")}>
              <SkipForward className="h-4 w-4" />
            </button>
          )}
          {!isCinema && canShowEpisodes && (
            <button type="button" onClick={openEpisodes} className="player-utility-button" aria-label={t("episodes")}>
              <List className="h-4 w-4" />
            </button>
          )}
          {isCinema && cinemaHost && canShowEpisodes && (
            <button type="button" onClick={openEpisodes} className="player-utility-button" aria-label={t("episodes")}>
              <List className="h-4 w-4" />
            </button>
          )}
          {!isCinema && onTheaterToggle && (
            <button
              type="button"
              onClick={onTheaterToggle}
              className={cn("player-utility-button", theaterMode && "text-zipo-accent")}
              aria-label={theaterMode ? t("exitTheater") : t("theaterMode")}
            >
              <Monitor className="h-4 w-4" />
            </button>
          )}
          {/* Fullscreen só no bar superior em modo embed (sem controles nativos). */}
          {mode === "embed" && (
            <button type="button" onClick={() => void toggleFullscreen()} className="player-utility-button" aria-label={isFullscreen ? t("exitFullscreen") : t("fullscreen")}>
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
    );

    if (isAdult) {
      return (
        <div className={cn("flex aspect-video items-center justify-center rounded-xl border border-zinc-800 bg-black", className)}>
          <p className="text-sm text-red-400">{tc("adultBlocked")}</p>
        </div>
      );
    }

    if (error && !source) {
      return (
        <PlayerErrorState
          code={error.code}
          message={error.message}
          onRetry={() => {
            automaticRetryRef.current = 0;
            setRetryToken((value) => value + 1);
          }}
          onShowTrailer={onShowTrailer}
          onBackToDetails={onBackToDetails}
          onReport={() => reportPlaybackIssue({
            contentType,
            contentId,
            episodeId,
            season: episodeSeason,
            episode: requestedEpisode,
            code: error.code,
          }).then(() => undefined)}
          onSwitchProvider={cyclePlayer}
          showSwitchProvider={availableProviders.length > 1}
          className={className}
        />
      );
    }

    return (
      <div
        ref={shellRef}
        tabIndex={0}
        data-variant={variant}
        className={cn(
          "overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent/70",
          isCinema
            ? "rounded-xl border border-amber-400/30 bg-[#0c0a08] shadow-[0_28px_70px_rgb(12_10_8_/_0.55)]"
            : "rounded-2xl border border-zipo-accent/15 bg-[#0f1410] shadow-[0_24px_60px_rgb(15_20_16_/_0.45)]",
          theaterMode && !isCinema && "border-zipo-accent/35",
          className,
        )}
      >
        {utilityBar}
        <div className="relative aspect-video w-full bg-black">
          {!prerollActive && mode === "embed" && secureEmbed && (
            <iframe
              key={secureEmbed.url}
              src={secureEmbed.url}
              title={`${title ?? "ZiPo"} · ${secureEmbed.label}`}
              className="absolute inset-0 h-full w-full border-0 bg-black"
              {...(secureEmbed.sandbox ? { sandbox: secureEmbed.sandbox } : {})}
              allow={secureEmbed.allow}
              referrerPolicy={secureEmbed.referrerPolicy}
              allowFullScreen
              onLoad={() => {
                setLoading(false);
                onReady?.();
              }}
              onError={() => {
                failSecureEmbed();
              }}
            />
          )}

          {prerollActive && playbackSession?.preroll && (
            <>
              <video
                key={playbackSession.preroll.impressionId}
                src={playbackSession.preroll.url}
                className="absolute inset-0 h-full w-full bg-black object-contain"
                autoPlay
                playsInline
                onCanPlay={(event) => {
                  void event.currentTarget.play().catch(() => setPrerollActive(false));
                }}
                onEnded={() => setPrerollActive(false)}
                onError={() => setPrerollActive(false)}
              />
              <span className="absolute left-3 top-3 z-20 rounded bg-black/80 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                Anúncio ZiPo
              </span>
              {prerollCanSkip && (
                <button
                  type="button"
                  onClick={() => setPrerollActive(false)}
                  className="absolute bottom-4 right-4 z-20 min-h-11 rounded-lg border border-white/30 bg-black/80 px-4 text-sm font-semibold text-white hover:bg-black"
                >
                  Pular anúncio
                </button>
              )}
            </>
          )}

          {!prerollActive && mode === "native" && source && (
            <video
              ref={videoRef}
              key={source.url}
              className="absolute inset-0 h-full w-full bg-black object-contain"
              src={source.type === "mp4" ? source.url : undefined}
              playsInline
              autoPlay={autoPlay}
              onClick={syncControlled ? undefined : togglePlay}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (sourceResumeTime > 0) {
                  const maxTime = Number.isFinite(video.duration)
                    ? Math.max(0, video.duration - 0.25)
                    : sourceResumeTime;
                  video.currentTime = Math.min(maxTime, sourceResumeTime);
                }
                video.volume = volume;
                video.muted = muted;
                video.playbackRate = playbackRate;
                setDuration(video.duration);
                setCurrentTime(video.currentTime);
                onDurationChange?.(video.duration);
                onReady?.();
                setLoading(false);
              }}
              onTimeUpdate={(event) => {
                const current = event.currentTarget.currentTime;
                setCurrentTime(current);
                onTimeUpdate?.(current);
                if (endTime != null && current >= endTime) event.currentTarget.pause();
              }}
              onProgress={(event) => {
                const video = event.currentTarget;
                if (video.buffered.length > 0) {
                  setBuffered(video.buffered.end(video.buffered.length - 1));
                }
              }}
              onPlay={() => {
                setIsPlaying(true);
                onPlay?.();
              }}
              onPause={() => {
                setIsPlaying(false);
                onPause?.();
              }}
              onVolumeChange={(event) => {
                setVolume(event.currentTarget.volume);
                setMuted(event.currentTarget.muted);
              }}
              onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
              onError={() => {
                if (source.type === "mp4" || !hlsRef.current) failNativeSource();
              }}
              onEnded={() => {
                setIsPlaying(false);
                onEnded?.();
                if (!isCinema && hasNextEpisode && onNextEpisode) setNextCountdown(5);
              }}
            >
              {source.textTracks?.map((track) => (
                <track
                  key={track.url}
                  kind="subtitles"
                  src={track.url}
                  srcLang={track.lang}
                  label={track.label ?? track.lang}
                  default={track.default}
                />
              ))}
            </video>
          )}

          {!prerollActive && mode === "native" && source && !loading && (
            <NativePlayerControls
              currentTime={currentTime}
              duration={duration}
              buffered={buffered}
              isPlaying={isPlaying}
              muted={muted}
              volume={volume}
              playbackRate={playbackRate}
              isFullscreen={isFullscreen}
              servers={nativeServers}
              sourceUrl={source.providerId ?? source.url}
              qualityLevels={qualityLevels}
              selectedQuality={selectedQuality}
              playbackLocked={syncControlled}
              labels={{
                play: t("play"),
                pause: t("pause"),
                mute: t("mute"),
                unmute: t("unmute"),
                volume: t("volume"),
                speed: t("speed"),
                quality: t("quality"),
                server: t("selectProvider"),
                fullscreen: t("fullscreen"),
                exitFullscreen: t("exitFullscreen"),
                skipBack: t("skipBack"),
                skipForward: t("skipForward"),
              }}
              onTogglePlay={togglePlay}
              onSeek={seekNative}
              onToggleMute={toggleMute}
              onVolume={changeVolume}
              onPlaybackRate={changePlaybackRate}
              onQuality={changeQuality}
              onServer={(url) => {
                if (syncControlled) return;
                const selected = nativeServers.find((item) => item.url === url);
                if (selected?.providerId) void activateProvider(selected.providerId);
              }}
              onPictureInPicture={togglePictureInPicture}
              onFullscreen={() => void toggleFullscreen()}
            />
          )}

          {loading && !prerollActive && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black">
              <Loader2 className="h-9 w-9 animate-spin text-zipo-accent motion-reduce:animate-none" />
              <p className="mt-3 text-sm text-white/60">{t("loadingEpisode")}</p>
            </div>
          )}

          <PlayerOverlayAd
            contentType={contentType}
            contentId={contentId}
            hidden={prerollActive || Boolean(error) || loading}
          />

          {mode === "native" && clipEnabled && onClipClick && (
            <button
              type="button"
              onClick={onClipClick}
              className="absolute right-3 top-3 z-10 flex min-h-11 items-center gap-2 rounded-lg bg-black/80 px-3 text-sm text-white"
            >
              <Scissors className="h-4 w-4" />
              {t("clipButton")}
            </button>
          )}

          {nextCountdown != null && mode === "native" && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80">
              <p className="text-white">{t("nextEpisodeIn", { seconds: nextCountdown })}</p>
              <button type="button" onClick={() => setNextCountdown(null)} className="mt-3 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-white">
                {t("cancelAutoplay")}
              </button>
            </div>
          )}

          {error && source && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
              <p className="text-sm text-zinc-300">{error.message}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setRetryToken((value) => value + 1);
                }}
                className="mt-4 flex min-h-11 items-center gap-2 rounded-lg bg-zipo-accent px-4 text-sm font-semibold text-white"
              >
                <RefreshCw className="h-4 w-4" />
                {t("retryPlayback")}
              </button>
              {availableProviders.length > 1 && (
                <button
                  type="button"
                  onClick={cyclePlayer}
                  className="mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-zinc-600 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent/70"
                >
                  {t("switchProvider")}
                </button>
              )}
            </div>
          )}
        </div>

        {episodes?.length && onEpisodeSelect && (
          <EpisodeDrawer
            open={episodeDrawerOpen}
            onClose={() => setEpisodeDrawerOpen(false)}
            episodes={episodes}
            currentEpisode={episodeNumber}
            currentSeason={episodeSeason}
            contentType={contentType}
            contentId={contentId}
            onSelect={(episode, season) => {
              onEpisodeSelect(episode, season);
              setEpisodeDrawerOpen(false);
            }}
          />
        )}
      </div>
    );
  },
);
