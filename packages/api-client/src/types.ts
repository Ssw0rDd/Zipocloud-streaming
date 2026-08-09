export type ContentType = "movie" | "series" | "anime";

export interface MediaImage {
  id: string;
  url: string;
  kind: "poster" | "backdrop" | "still";
  width?: number;
  height?: number;
  format?: "webp" | "avif" | "jpeg" | "png";
  source?: string;
}

export interface ViewerAccess {
  authenticated: boolean;
  adult: boolean;
  canView: boolean;
  requiresLogin: boolean;
  reason?: "ADULT_LOGIN_REQUIRED";
}

export interface PlaybackAccess {
  mode: "native" | "preparing" | "secure_embed" | "unavailable" | "unknown";
  catalogAvailability: "available" | "unavailable" | "unknown";
  providerIds?: string[];
  reason?: "RESOLVE_REQUIRED" | "NO_NATIVE_SOURCE" | "NO_SAFE_SOURCE" | "MEDIA_PREPARING";
}

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
  images?: { poster?: MediaImage; backdrop?: MediaImage; stills?: MediaImage[] };
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
}

export interface SeasonInfo {
  number: number;
  name?: string;
  episodeCount?: number;
  poster?: string;
  episodes?: EpisodeInfo[];
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

export interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  services: Record<string, "up" | "down" | "disabled" | "unconfigured" | "unknown">;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ZipoClientOptions {
  baseUrl?: string;
  credentials?: RequestCredentials;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ZipoRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ZipoErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isSupporter?: boolean;
  adultConfirmedAt?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  session: { id: string; expiresAt: string };
}

export interface SignInInput { email: string; password: string }
export interface SignUpInput extends SignInInput { name: string }

export interface Account extends AuthUser {
  adultConfirmed: boolean;
  adultConfirmedAt: string | null;
}

export interface SearchResponse {
  items: ContentItem[];
  total?: number;
  page?: number;
  totalPages?: number;
}

export interface AggregateManifest {
  id: string;
  type: ContentType;
  locale: string;
  metadata: ContentDetail;
  episodes?: unknown[];
  playback?: PlaybackDiscovery;
}

export interface PlaybackSource {
  type: "hls" | "mp4" | "iframe";
  url: string;
  providerId: string;
  isDefault?: boolean;
  headers?: Record<string, string>;
}

export interface PlaybackDiscovery {
  providers?: Array<{ id: string; label: string; available: boolean }>;
  sources: PlaybackSource[];
}

export interface Comment {
  id: string;
  contentId: string;
  contentType?: string;
  userId: string;
  userName?: string;
  body: string;
  episodeNumber?: number | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateCommentInput { body: string; episodeNumber?: number }

export interface CreateClipInput {
  contentType: ContentType;
  contentId: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
  episodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface Clip {
  token: string;
  contentId: string;
  contentType: ContentType;
  title: string;
  startTime?: number;
  endTime?: number;
  startSeconds?: number;
  endSeconds?: number;
  shareUrl?: string;
  status?: string;
}

export interface Playlist { id: string; name: string; createdAt: string; updatedAt: string }
export interface PlaylistDetail { playlist: Playlist; items: Array<{ id: string; contentType: ContentType; contentId: string; addedAt: string }> }

export interface DonationConfig {
  enabled: boolean;
  amountCents: number | null;
  currency: "BRL";
  entitlement: "lifetime_supporter";
}

export interface CreatePixOrderResult {
  order: {
    id: string;
    status: string;
    amountCents: number;
    currency: "BRL";
    qrCode?: string | null;
    qrCodeBase64?: string | null;
    ticketUrl?: string | null;
    expiresAt?: string | null;
  };
}
