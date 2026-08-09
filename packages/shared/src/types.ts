import type { ContentType } from "./constants";
import type { AdTier } from "./constants";
import type { MediaImage } from "./images";
import type { ReactionValue } from "./schemas";

export interface ContentItem {
  id: string;
  type: ContentType;
  title: string;
  originalTitle?: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  posterCandidates?: string[];
  stillCandidates?: string[];
  images?: {
    poster?: MediaImage;
    backdrop?: MediaImage;
    stills?: MediaImage[];
  };
  year?: number;
  rating?: number;
  genres?: string[];
  isAdult: boolean;
  access?: ViewerAccess;
  externalIds?: {
    imdb?: string;
    tvmaze?: number;
    mal?: number;
    anilist?: number;
    kitsu?: string;
    tmdb?: number;
  };
  playbackAvailability?: "available" | "unavailable" | "unknown";
  playbackAccess?: PlaybackAccess;
  localization?: {
    requestedLocale: string;
    resolvedTitleLocale: string;
    resolvedDescriptionLocale?: string;
    titleFallback: boolean;
    descriptionFallback: boolean;
  };
}

export interface CacheMetadata {
  generatedAt: string;
  stale: boolean;
  partial: boolean;
  cacheStatus: "fresh" | "stale" | "miss" | "bypass";
}

export interface HomeDocumentV3 {
  data: {
    /** Reuses the featured shape from the home aggregate. */
    featured: unknown;
    sections: Array<{ id: string; title: string; type: string; items: ContentItem[] }>;
  };
  meta: CacheMetadata;
}

export interface ContentDetail extends ContentItem {
  runtime?: number;
  status?: string;
  cast?: string[];
  director?: string[];
  trailer?: string;
  seasons?: SeasonInfo[];
  episodes?: EpisodeInfo[];
}

export interface SeasonInfo {
  number: number;
  name?: string;
  episodeCount?: number;
  poster?: string;
  episodes?: EpisodeInfo[];
}

export interface EpisodeInfo {
  id: string;
  number: number;
  season?: number;
  title: string;
  description?: string;
  airDate?: string;
  aired?: string;
  runtime?: number;
  still?: string;
  stillCandidates?: string[];
  externalIds?: {
    mal?: number;
    kitsu?: string;
    tvmaze?: number;
  };
}

export interface EnrichedContent extends ContentDetail {
  sources?: {
    jikan?: boolean;
    anilist?: number;
    kitsu?: string;
    tvmaze?: number;
    cinemeta?: boolean;
  };
  characters?: { name: string; image?: string; role?: string }[];
  relations?: { title: string; type: string; id: string; poster?: string }[];
  recommendations?: { title: string; id: string; poster?: string }[];
  scores?: { provider: string; value: number; max?: number }[];
  production?: {
    studio?: string;
    country?: string;
    network?: string;
    status?: string;
  };
  castCredits?: CastCredit[];
  descriptionLocalized?: string;
  descriptionLang?: string;
  descriptionIsOriginal?: boolean;
}

export interface CastCredit {
  personId: number;
  name: string;
  character?: string;
  image?: string;
}

export interface PersonDetail {
  id: number;
  name: string;
  birthday?: string;
  deathday?: string;
  gender?: string;
  image?: string;
  country?: string;
}

export interface PlaybackCapabilities {
  mode?: "native" | "provider-iframe";
  handoffToProvider?: boolean;
  supportsQualitySwitch?: boolean;
  supportsAutoFallback?: boolean;
  requiresUnsandboxedFrame?: boolean;
  /** Native source must be prepared by the trusted media worker before playback. */
  requiresPreparation?: boolean;
  progressBridge?: "videasy" | "vidking" | "vidlink";
  resumeQueryParam?: "progress" | "startAt";
}

export interface EmbedTextTrack {
  url: string;
  lang: string;
  label?: string;
  default?: boolean;
}

export interface EmbedSource {
  type: "iframe" | "hls" | "mp4";
  url: string;
  label?: string;
  quality?: string;
  isDefault?: boolean;
  providerId?: string;
  capabilities?: PlaybackCapabilities;
  textTracks?: EmbedTextTrack[];
}

export interface PlaybackProviderInfo {
  id: string;
  label: string;
  available: boolean;
  latencyMs?: number;
  degraded?: boolean;
  error?: string;
}

export interface PlaybackManifest {
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  providers: PlaybackProviderInfo[];
  sources: EmbedSource[];
}

export interface ViewerAccess {
  authenticated: boolean;
  adult: boolean;
  canView: boolean;
  requiresLogin: boolean;
  reason?: "ADULT_LOGIN_REQUIRED";
}

export interface PlaybackServer {
  id: string;
  providerId?: string;
  label: string;
  type: "hls" | "mp4";
  language?: string;
  quality?: string;
  subtitles: EmbedTextTrack[];
  available: boolean;
  selected: boolean;
}

export interface PlaybackPreroll {
  url: string;
  type: "mp4" | "webm";
  skipAfterSeconds: number;
  impressionId: string;
}

export interface PlaybackSession {
  id: string;
  sessionToken: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  selectedServerId: string;
  servers: PlaybackServer[];
  streamUrl: string;
  expiresAt: string;
  preroll?: PlaybackPreroll;
}

export type PlaybackAccessMode =
  | "native"
  | "preparing"
  | "secure_embed"
  | "unavailable"
  | "unknown";

export type CatalogPlaybackAvailability = "available" | "unavailable" | "unknown";

export interface PlaybackAccess {
  mode: PlaybackAccessMode;
  catalogAvailability: CatalogPlaybackAvailability;
  providerIds?: string[];
  reason?:
    | "RESOLVE_REQUIRED"
    | "NO_NATIVE_SOURCE"
    | "NO_SAFE_SOURCE"
    | "MEDIA_PREPARING";
}

export interface SecureEmbedPlayback {
  providerId: string;
  label: string;
  url: string;
  /**
   * Sandbox token for first-party-safe embeds.
   * `null` means the provider requires an unsandboxed iframe (SuperFlix/Warez/2Embed).
   */
  sandbox: "allow-scripts allow-same-origin allow-forms allow-presentation" | null;
  allow: "autoplay; fullscreen; encrypted-media; picture-in-picture";
  referrerPolicy: "no-referrer";
}

export interface MediaPreparation {
  id: string;
  status: "queued" | "processing" | "ready" | "failed";
  progress: number;
  retryAfterSeconds?: number;
  errorCode?: "PREPARATION_FAILED" | "PREPARATION_EXPIRED";
  expiresAt: string;
}

export type PlaybackBootstrap =
  | { mode: "native"; session: PlaybackSession }
  | { mode: "preparing"; preparation: MediaPreparation }
  | {
      mode: "embed";
      embed: SecureEmbedPlayback;
      /** Safe sandboxed alternatives. Older clients may ignore this field. */
      embeds?: SecureEmbedPlayback[];
      /** First-party ZiPo preroll (own ads). Present for guest/member when enabled. */
      preroll?: PlaybackPreroll;
    }
  | {
      mode: "unavailable";
      code: "PLAYBACK_UNAVAILABLE";
      reason: "NO_NATIVE_SOURCE" | "NO_SAFE_SOURCE";
    };

export interface CinemaRoom {
  id: string;
  token: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  hostParticipantId: string;
  hasPassword: boolean;
  isAdult: boolean;
  maxParticipants: number;
  participantCount: number;
  expiresAt: string;
}

export interface CinemaParticipant {
  id: string;
  userId?: string;
  name: string;
  guest: boolean;
  host: boolean;
  muted: boolean;
  joinedAt: string;
}

export interface CinemaState {
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  playbackServerId?: string;
  positionSeconds: number;
  paused: boolean;
  playbackRate: number;
  version: number;
  serverTime: number;
  hostParticipantId: string;
}

export type CinemaEventType =
  | "snapshot"
  | "play"
  | "pause"
  | "seek"
  | "rate"
  | "episode"
  | "server"
  | "chat"
  | "typing"
  | "delete-message"
  | "mute"
  | "kick"
  | "heartbeat"
  | "system"
  | "error";

export interface CinemaEvent {
  id: string;
  type: CinemaEventType;
  roomId: string;
  participantId: string;
  version?: number;
  payload?: Record<string, unknown>;
  serverTime: number;
}

export type CinemaMessageType = "text" | "print" | "clip" | "system";
export type CinemaMessageStatus = "pending" | "ready" | "error";

export interface CinemaMessage {
  id: string;
  roomId: string;
  participantId?: string;
  participantName: string;
  guest: boolean;
  type: CinemaMessageType;
  status: CinemaMessageStatus;
  body?: string;
  attachment?: MediaAttachment;
  createdAt: string;
  deletedAt?: string;
}

export interface MediaAttachment {
  id: string;
  kind: "print" | "clip";
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  url?: string;
  expiresAt: string;
}

export type ClipJobStatus = "queued" | "processing" | "ready" | "failed" | "expired";

export interface ClipJob {
  id: string;
  clipId: string;
  userId: string;
  status: ClipJobStatus;
  progress: number;
  attempts: number;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface EmbedResponse {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  sources: EmbedSource[];
  providers: PlaybackProviderInfo[];
  requiresSelection?: boolean;
  hasAvailableSources?: boolean;
}

export interface CatalogResponse {
  type: ContentType;
  items: ContentItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface SearchResponse {
  query: string;
  items: ContentItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface FeaturedResponse {
  movies: ContentItem[];
  series: ContentItem[];
  anime: ContentItem[];
}

export interface ViewRecordResponse {
  ok: true;
  queued: boolean;
}

export interface ClipRecord {
  id: string;
  token: string;
  contentType: ContentType;
  contentId: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
  episodeId?: string;
  season?: number;
  episode?: number;
  isAdult?: boolean;
  createdAt: string;
  shareUrl: string;
  status?: ClipJobStatus;
  progress?: number;
  downloadUrl?: string;
  expiresAt?: string;
}

export interface CommentRecord {
  id: string;
  animeId: number;
  userId: string;
  userName: string;
  body: string;
  episodeNumber?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdConfig {
  tier: AdTier;
  placements: AdPlacement[];
  refreshIntervalSeconds: number;
}

export interface AdPlacement {
  id: string;
  type: "banner" | "preroll" | "midroll" | "sidebar" | "overlay" | "native";
  enabled: boolean;
  adUnitId: string;
  placement?: string;
  /** First-party click-through URL for overlay/corner ads */
  href?: string;
  label?: string;
}

export interface AdImpressionResponse {
  ok: true;
  recorded: boolean;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  services: {
    database: "up" | "down";
    redis: "up" | "down";
    tmdb: "up" | "down" | "disabled" | "unconfigured" | "unknown";
    superflix: "up" | "down" | "disabled" | "unconfigured" | "unknown";
    warezcdn: "up" | "down" | "disabled" | "unconfigured" | "unknown";
    megafrix: "up" | "down" | "disabled" | "unconfigured" | "unknown";
    megaflix: "up" | "down" | "disabled" | "unconfigured" | "unknown";
  };
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

export type PlaybackIssueCode =
  | "PLAYBACK_UNAVAILABLE"
  | "SESSION_EXPIRED"
  | "ADULT_LOGIN_REQUIRED"
  | "RATE_LIMIT_EXCEEDED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "PLAYBACK_FAILED";

export interface PlaybackIssueReport {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  season?: number;
  episode?: number;
  code: PlaybackIssueCode;
  providerId?: string;
}

export interface DonateNotImplemented {
  error: string;
  code: "NOT_IMPLEMENTED";
}

export interface ReactionCounts {
  likes: number;
  dislikes: number;
  userReaction?: ReactionValue;
}

export interface ReactionResponse extends ReactionCounts {
  contentType: ContentType;
  contentId: string;
}

export interface AggregatorQuery {
  locale?: string;
  audioLang?: string;
  subtitleLang?: string;
  includePlayback?: boolean;
  season?: number;
  episode?: number;
}

export interface AggregatedPlaybackPrefs {
  audioLang: string;
  subtitleLang: string;
}

export interface AggregatedPlayback {
  providers: PlaybackProviderInfo[];
  sources: EmbedSource[];
  prefs: AggregatedPlaybackPrefs;
}

export interface AggregatedManifest {
  id: string;
  type: ContentType;
  locale: string;
  metadata: EnrichedContent;
  episodes: EpisodeInfo[];
  playback?: AggregatedPlayback;
}

export type { ReactionAction, ReactionBody } from "./schemas";
