import type { ContentType, EpisodeInfo, EmbedSource, EmbedResponse, PlaybackProviderInfo } from "@zipo/shared";

export type { EmbedSource, EmbedResponse, PlaybackProviderInfo };

export interface ZiPoPlayerHandle {
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
  captureFrame: () => string | null;
}

export interface PlayerModeCapabilities {
  mode: "loading" | "native" | "embed";
  canControlMedia: boolean;
  canTrackProgress: boolean;
  canResume: boolean;
  /** True only for native Player 1 when it is MegaFrix HLS (.m3u8). Clips + Cinema. */
  canCreateClips: boolean;
  /** Alias for canCreateClips — full Cinema (sync/print/chat clips) needs the same source. */
  canOpenCinema: boolean;
  canAutoplayNext: boolean;
}

export interface ZiPoPlayerProps {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  episodeNumber?: number;
  episodeSeason?: number;
  embedUrl?: string;
  title?: string;
  isAdult?: boolean;
  className?: string;
  startTime?: number;
  endTime?: number;
  autoPlay?: boolean;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPause?: () => void;
  onPlay?: () => void;
  onSeek?: (seconds: number) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onServerChange?: (serverId: string) => void;
  onReady?: () => void;
  clipEnabled?: boolean;
  onClipClick?: () => void;
  theaterMode?: boolean;
  onTheaterToggle?: () => void;
  showEpisodesButton?: boolean;
  onEpisodesClick?: () => void;
  episodes?: EpisodeInfo[];
  onEpisodeSelect?: (ep: number, season?: number) => void;
  hasPrevEpisode?: boolean;
  onPrevEpisode?: () => void;
  hasNextEpisode?: boolean;
  onNextEpisode?: () => void;
  episodesInSidebar?: boolean;
  onEnded?: () => void;
  preferredProviderId?: string;
  onShowTrailer?: () => void;
  onBackToDetails?: () => void;
  /** Cinema participants receive authoritative playback state from the host. */
  syncControlled?: boolean;
  /** Distinct chrome for Cinema rooms (MegaFrix host/guest watch party). */
  variant?: "watch" | "cinema";
  /** Shown in cinema chrome when the local user is the room host. */
  cinemaHost?: boolean;
  /** Live participant count badge for cinema chrome. */
  cinemaViewerCount?: number;
  onCapabilitiesChange?: (capabilities: PlayerModeCapabilities) => void;
}

export type QualityOption = "auto" | "1080" | "720" | "480";
