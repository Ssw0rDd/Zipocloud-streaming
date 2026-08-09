"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContentType } from "@zipo/shared";
import type {
  PlayerModeCapabilities,
  ZiPoPlayerHandle,
} from "@/components/player/types";
import { AdBlockPlayerGate } from "@/components/ads";
import { PageTransition } from "@/components/ContentRow";
import { Skeleton, WatchPageSkeleton } from "@/components/Skeleton";
import {
  fetchContentById,
  fetchEpisodes,
  fetchViewProgress,
  recordView,
  createCinemaRoomRequest,
  fetchPublicFeatures,
} from "@/lib/api";
import { CATALOG_STALE_TIME, queryKeys } from "@/lib/query-config";
import { usePathname, useRouter, Link } from "@/i18n/routing";
import { useAuth } from "@/hooks/useAuth";
import { useViewTracking } from "@/hooks/useViewTracking";
import { AddToPlaylistButton } from "@/components/playlists/AddToPlaylistButton";
import { TrailerModal } from "@/components/TrailerModal";
import { formatPlayerTime } from "@/components/player/utils";
import {
  parseWatchEpisodeParam,
  watchEpisodeQuery,
} from "@/lib/watch-episode";
import { cn } from "@/lib/utils";
import { fetchTrailer } from "@/lib/enriched-content";
import { useTranslations, useLocale } from "next-intl";
import { ChevronLeft, Loader2, Users, X } from "lucide-react";

const ZiPoPlayer = dynamic(
  () => import("@/components/player/ZiPoPlayer").then((mod) => mod.ZiPoPlayer),
  {
    ssr: false,
    loading: () => <Skeleton className="aspect-video w-full rounded-xl" />,
  },
);

const ClipModal = dynamic(
  () => import("@/components/player/ClipModal").then((mod) => mod.ClipModal),
  { ssr: false },
);

const EpisodeDrawer = dynamic(
  () => import("@/components/player/EpisodeDrawer").then((mod) => mod.EpisodeDrawer),
  { ssr: false },
);

function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 1_200 });
      return;
    }
    globalThis.setTimeout(resolve, 350);
  });
}

function WatchContent({ type, id }: { type: ContentType; id: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const tw = useTranslations("watch");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { isLoggedIn, tier } = useAuth();
  const epNum = searchParams.get("ep");
  const seasonParam = searchParams.get("season");
  const resumeRequested = searchParams.get("resume") === "1";
  const playerRef = useRef<ZiPoPlayerHandle>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [clipModalOpen, setClipModalOpen] = useState(false);
  const [cinemaDialogOpen, setCinemaDialogOpen] = useState(false);
  const [cinemaPassword, setCinemaPassword] = useState("");
  const [cinemaCreating, setCinemaCreating] = useState(false);
  const [cinemaError, setCinemaError] = useState<string | null>(null);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [resumeTime, setResumeTime] = useState<number | undefined>();
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [playerCapabilities, setPlayerCapabilities] =
    useState<PlayerModeCapabilities>({
      mode: "loading",
      canControlMedia: false,
      canTrackProgress: false,
      canResume: false,
      canCreateClips: false,
      canOpenCinema: false,
      canAutoplayNext: false,
    });
  const recordedOpenRef = useRef<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setSidebarVisible(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const { data: features } = useQuery({
    queryKey: ["public-features"],
    queryFn: fetchPublicFeatures,
    staleTime: 60_000,
  });
  const cinemaEnabled =
    features?.cinemaEnabled ?? process.env.NEXT_PUBLIC_CINEMA_ENABLED === "true";

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.content(type, id, locale),
    queryFn: () => fetchContentById(type, id, locale),
    staleTime: CATALOG_STALE_TIME,
  });

  const { data: episodesData } = useQuery({
    queryKey: ["episodes", type, id, locale, "base"],
    queryFn: () => fetchEpisodes(type, id, { includeImages: false, locale }),
    enabled: type !== "movie",
    staleTime: CATALOG_STALE_TIME,
  });

  const { data: trailerData } = useQuery({
    queryKey: ["trailer", type, id],
    queryFn: () => fetchTrailer(type, id),
    staleTime: CATALOG_STALE_TIME,
  });

  const { data: episodeImagesData } = useQuery({
    queryKey: ["episodes", type, id, locale, "images"],
    queryFn: async () => {
      await waitForIdle();
      return fetchEpisodes(type, id, { includeImages: true, locale });
    },
    enabled: type === "anime" && Boolean(episodesData?.episodes?.length),
    staleTime: CATALOG_STALE_TIME,
  });

  const episodes =
    episodeImagesData?.episodes ?? episodesData?.episodes ?? data?.episodes;

  useEffect(() => {
    if (type === "movie") return;

    if (!episodes?.length) return;
    const parsedEpisode = parseWatchEpisodeParam(epNum);
    const parsedSeason = parseWatchEpisodeParam(seasonParam);
    const target =
      episodes.find(
        (candidate) =>
          candidate.number === parsedEpisode &&
          (parsedSeason == null || (candidate.season ?? 1) === parsedSeason),
      ) ?? episodes[0]!;
    const targetSeason = target.season ?? 1;
    if (
      parsedEpisode !== target.number ||
      parsedSeason !== targetSeason
    ) {
      router.replace(
        `${pathname}${watchEpisodeQuery(target.number, targetSeason)}${resumeRequested ? "&resume=1" : ""}`,
        { scroll: false },
      );
    }
  }, [type, epNum, seasonParam, episodes, router, pathname, resumeRequested]);

  const parsedEpisode = parseWatchEpisodeParam(epNum);
  const parsedSeason = parseWatchEpisodeParam(seasonParam);
  const episode =
    episodes?.find(
      (candidate) =>
        candidate.number === parsedEpisode &&
        (parsedSeason == null || (candidate.season ?? 1) === parsedSeason),
    ) ?? episodes?.[0];
  const currentEpNumber = episode?.number ?? parsedEpisode ?? 1;
  const currentSeason = episode?.season ?? parsedSeason ?? 1;
  const currentEpisodeIndex = episodes?.findIndex((candidate) => candidate.id === episode?.id) ?? -1;

  const prevEpisode = useMemo(() => {
    if (!episodes?.length || currentEpisodeIndex <= 0) return null;
    return episodes[currentEpisodeIndex - 1] ?? null;
  }, [episodes, currentEpisodeIndex]);

  const nextEpisode = useMemo(() => {
    if (!episodes?.length || currentEpisodeIndex < 0) return null;
    return episodes[currentEpisodeIndex + 1] ?? null;
  }, [episodes, currentEpisodeIndex]);

  const { flushProgress, markCompleted, resetProgress } = useViewTracking({
    contentType: type,
    contentId: id,
    episodeId: episode?.id,
    seasonNumber: episode?.season ?? currentSeason,
    episodeNumber: episode?.number ?? currentEpNumber,
    progressSeconds: Math.floor(currentTime),
    durationSeconds: Math.floor(duration),
    enabled: Boolean(data) && playerCapabilities.canTrackProgress,
  });

  const handleEpisodeSelect = useCallback(
    (ep: number, season?: number) => {
      if (!Number.isFinite(ep) || ep < 1) return;
      router.replace(`${pathname}${watchEpisodeQuery(ep, season)}`, { scroll: false });
    },
    [router, pathname],
  );

  const goToPrevEpisode = useCallback(() => {
    if (!prevEpisode) return;
    router.replace(
      `${pathname}${watchEpisodeQuery(prevEpisode.number, prevEpisode.season)}`,
      { scroll: false },
    );
  }, [prevEpisode, router, pathname]);

  const goToNextEpisode = useCallback(() => {
    if (!nextEpisode) return;
    router.replace(
      `${pathname}${watchEpisodeQuery(nextEpisode.number, nextEpisode.season)}`,
      { scroll: false },
    );
  }, [nextEpisode, router, pathname]);

  const { data: savedProgress } = useQuery({
    queryKey: ["viewProgress", type, id],
    queryFn: () => fetchViewProgress(type, id),
    staleTime: 30_000,
  });

  const savedEpisodeTarget = useMemo(() => {
    if (type === "movie") return undefined;
    return episodes?.find((candidate) =>
      savedProgress?.episodeId
        ? candidate.id === savedProgress.episodeId
        : candidate.number === savedProgress?.episodeNumber &&
          (candidate.season ?? 1) === (savedProgress?.seasonNumber ?? 1),
    );
  }, [episodes, savedProgress, type]);

  const canResume = useMemo(() => {
    if (
      !playerCapabilities.canResume ||
      resumeDismissed ||
      resumeTime != null ||
      !savedProgress?.progressSeconds
    ) {
      return false;
    }
    const progress = savedProgress.progressSeconds;
    if (progress < 10) return false;
    if (
      savedProgress.durationSeconds &&
      progress >= savedProgress.durationSeconds * 0.95
    ) {
      return false;
    }
    if (type !== "movie" && savedProgress.episodeId && !savedEpisodeTarget) return false;
    return true;
  }, [
    playerCapabilities.canResume,
    resumeDismissed,
    resumeTime,
    savedProgress,
    type,
    savedEpisodeTarget,
  ]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setResumeTime(undefined);
    setResumeDismissed(false);
  }, [episode?.id]);

  useEffect(() => {
    if (!resumeRequested || !canResume || !savedProgress) return;
    if (
      type !== "movie" &&
      savedEpisodeTarget &&
      savedEpisodeTarget.id !== episode?.id
    ) {
      router.replace(
        `${pathname}${watchEpisodeQuery(
          savedEpisodeTarget.number,
          savedEpisodeTarget.season,
        )}&resume=1`,
        { scroll: false },
      );
      return;
    }
    setResumeTime(savedProgress.progressSeconds);
  }, [
    resumeRequested,
    canResume,
    savedProgress,
    savedEpisodeTarget,
    type,
    episode?.id,
    router,
    pathname,
  ]);

  useEffect(() => {
    if (playerCapabilities.mode !== "native" || !data) return;
    const key = `${type}:${id}:${episode?.id ?? "movie"}`;
    if (recordedOpenRef.current === key) return;
    recordedOpenRef.current = key;
    void recordView({
      contentType: type,
      contentId: id,
      episodeId: episode?.id,
    });
  }, [playerCapabilities.mode, data, type, id, episode?.id]);

  if (isLoading) {
    return <WatchPageSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-zipo-border bg-zipo-surface px-6 py-12 text-center">
        <p className="text-zipo-muted">{tc("error")}</p>
      </div>
    );
  }

  const title = episode ? `${data.title} — ${episode.title}` : data.title;
  const hasEpisodes = Boolean(episodes && episodes.length > 0);
  const adultBlocked = data.isAdult && data.access?.canView !== true;
  const canClip =
    isLoggedIn && !adultBlocked && playerCapabilities.canCreateClips;
  const canOpenCinema =
    cinemaEnabled && isLoggedIn && !adultBlocked && playerCapabilities.canOpenCinema;

  const createCinema = async () => {
    setCinemaCreating(true);
    setCinemaError(null);
    try {
      const response = await createCinemaRoomRequest({
        contentType: type,
        contentId: id,
        episodeId: episode?.id,
        season: episode?.season ?? currentSeason,
        episode: episode?.number ?? currentEpNumber,
        password: cinemaPassword || undefined,
      });
      sessionStorage.setItem(`zipo:cinema:access:${response.room.token}`, JSON.stringify(response));
      router.push(`/cinema/${response.room.token}`);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Falha ao criar sala";
      setCinemaError(
        message.includes("MegaFrix") || message.includes("CINEMA_REQUIRES")
          ? "Cinema só com Player 1 MegaFrix em HLS (m3u8). Aguarde o player nativo ou troque de título."
          : message,
      );
    } finally {
      setCinemaCreating(false);
    }
  };
  const showDesktopSidebar = hasEpisodes && !theaterMode && sidebarVisible;

  return (
    <div
      className={cn(
        "mx-auto",
        theaterMode ? "max-w-[min(100%,1600px)]" : "max-w-6xl",
      )}
    >
      <div
        className={cn(
          "grid gap-8",
          !theaterMode && "lg:grid-cols-[minmax(0,1fr)_320px]",
          theaterMode && "gap-4",
        )}
      >
        <div className={cn(theaterMode && "mx-auto w-full max-w-none")}>
          <Link
            href={`/${type}/${id}`}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-zipo-muted transition-colors hover:text-zipo-text"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tw("backToDetail")}
          </Link>

          <h1
            className={cn(
              "mb-4 font-bold tracking-wide text-zipo-text",
              theaterMode ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl",
            )}
          >
            {title}
          </h1>

          <div className="mb-4 flex flex-wrap gap-2">
            <AddToPlaylistButton contentType={type} contentId={id} />
            {canOpenCinema && (
              <button
                type="button"
                onClick={() => setCinemaDialogOpen(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zipo-accent/40 px-4 text-sm font-semibold text-zipo-accent hover:bg-zipo-accent/10"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                Criar Cinema ZiPo
              </button>
            )}
            {cinemaEnabled && isLoggedIn && !canOpenCinema && playerCapabilities.mode === "native" && (
              <span className="inline-flex min-h-11 items-center rounded-lg border border-zipo-border px-3 text-xs text-zipo-muted">
                Cinema precisa do Player 1 MegaFrix (HLS)
              </span>
            )}
          </div>

          {cinemaDialogOpen && (
            <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="cinema-create-title">
              <div className="w-full max-w-md rounded-2xl border border-zipo-border bg-zipo-surface p-6 shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="cinema-create-title" className="text-xl font-semibold text-zipo-text">Criar Cinema ZiPo</h2>
                  <button type="button" onClick={() => setCinemaDialogOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-zipo-muted" aria-label="Fechar"><X className="h-5 w-5" /></button>
                </div>
                <p className="mt-2 text-sm text-zipo-muted">
                  Até 50 pessoas no Player 1 MegaFrix (HLS). Você controla play, pause e seek no player;
                  convidados seguem e usam o chat (print/clip). Link privado expira após 24h sem atividade.
                </p>
                <label htmlFor="cinema-room-password" className="mt-5 block text-sm font-medium text-zipo-text">Senha opcional</label>
                <input id="cinema-room-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={cinemaPassword} onChange={(event) => setCinemaPassword(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-zipo-border bg-zipo-bg px-3 text-base text-zipo-text" />
                {cinemaError && <p role="alert" className="mt-3 text-sm text-red-400">{cinemaError}</p>}
                <button type="button" onClick={() => void createCinema()} disabled={cinemaCreating || (cinemaPassword.length > 0 && cinemaPassword.length < 8)} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-zipo-accent px-4 font-semibold text-white disabled:opacity-50">
                  {cinemaCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                  Criar sala
                </button>
              </div>
            </div>
          )}

          {canResume && savedProgress && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zipo-accent/30 bg-zipo-accent/10 px-4 py-3">
              <p className="text-sm text-zipo-text">
                {tw("resumeFrom", {
                  time: formatPlayerTime(savedProgress.progressSeconds),
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      type !== "movie" &&
                      savedEpisodeTarget &&
                      savedEpisodeTarget.id !== episode?.id
                    ) {
                      router.replace(
                        `${pathname}${watchEpisodeQuery(
                          savedEpisodeTarget.number,
                          savedEpisodeTarget.season,
                        )}&resume=1`,
                        { scroll: false },
                      );
                    } else {
                      setResumeTime(savedProgress.progressSeconds);
                    }
                  }}
                  className="rounded-lg bg-zipo-accent px-4 py-2 text-sm font-semibold text-white hover:bg-zipo-accent-hover"
                >
                  {tw("resume")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetProgress();
                    queryClient.setQueryData(["viewProgress", type, id], null);
                    setResumeDismissed(true);
                    setResumeTime(0);
                    playerRef.current?.seekTo(0);
                  }}
                  className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {tw("startOver")}
                </button>
              </div>
            </div>
          )}

          <AdBlockPlayerGate userTier={tier}>
            <div className={cn("mx-auto w-full", theaterMode ? "max-w-none" : "max-w-4xl")}>
              <ZiPoPlayer
                ref={playerRef}
                contentType={type}
                contentId={id}
                episodeId={episode?.id}
                episodeNumber={episode?.number ?? currentEpNumber}
                episodeSeason={episode?.season ?? currentSeason}
                isAdult={adultBlocked}
                title={title}
                startTime={playerCapabilities.canResume ? resumeTime : undefined}
                onTimeUpdate={setCurrentTime}
                onDurationChange={setDuration}
                onPause={flushProgress}
                onEnded={markCompleted}
                clipEnabled={canClip}
                onClipClick={() => setClipModalOpen(true)}
                theaterMode={theaterMode}
                onTheaterToggle={() => setTheaterMode((v) => !v)}
                episodes={hasEpisodes ? episodes : undefined}
                onEpisodeSelect={hasEpisodes ? handleEpisodeSelect : undefined}
                episodesInSidebar={showDesktopSidebar}
                hasPrevEpisode={Boolean(prevEpisode)}
                onPrevEpisode={goToPrevEpisode}
                hasNextEpisode={Boolean(nextEpisode)}
                onNextEpisode={goToNextEpisode}
                onCapabilitiesChange={setPlayerCapabilities}
                onShowTrailer={trailerData?.trailer ? () => setTrailerOpen(true) : undefined}
                onBackToDetails={() => router.push(`/${type}/${id}`)}
              />
            </div>
          </AdBlockPlayerGate>
          {trailerData?.trailer && (
            <TrailerModal
              open={trailerOpen}
              onClose={() => setTrailerOpen(false)}
              trailer={trailerData.trailer}
              title={data.title}
            />
          )}
        </div>

        <aside
          className={cn(
            "space-y-6",
            theaterMode && "hidden",
          )}
        >
          {hasEpisodes && (
            <div className="hidden lg:block">
              <EpisodeDrawer
                open
                onClose={() => {}}
                episodes={episodes!}
                currentEpisode={currentEpNumber}
                currentSeason={currentSeason}
                contentType={type}
                contentId={id}
                variant="sidebar"
                onSelect={handleEpisodeSelect}
              />
            </div>
          )}
        </aside>
      </div>

      {canClip && (
        <ClipModal
          open={clipModalOpen}
          onClose={() => setClipModalOpen(false)}
          contentType={type}
          contentId={id}
          contentTitle={title}
          episodeId={episode?.id}
          episodeNumber={episode?.number ?? currentEpNumber}
          episodeSeason={episode?.season ?? currentSeason}
          embedUrl={undefined}
          isAdult={adultBlocked}
          isLoggedIn={isLoggedIn}
          duration={duration}
          onDurationChange={setDuration}
          playerRef={playerRef}
          userTier={tier}
        />
      )}
    </div>
  );
}

export function WatchPageClient({ type, id }: { type: ContentType; id: string }) {
  return (
    <PageTransition>
      <div className="px-4 py-8 sm:px-6">
        <Suspense fallback={<WatchPageSkeleton />}>
          <WatchContent type={type} id={id} />
        </Suspense>
      </div>
    </PageTransition>
  );
}
