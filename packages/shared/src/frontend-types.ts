/** Frontend-oriented types (legacy / web agent) */
export type ContentType = "movie" | "series" | "anime";
export type UserTier = "guest" | "member" | "supporter";

export interface ContentItem {
  id: string;
  type: ContentType;
  title: string;
  originalTitle?: string;
  description?: string;
  posterUrl?: string;
  backdropUrl?: string;
  posterCandidates?: string[];
  stillCandidates?: string[];
  year?: number;
  rating?: number;
  genres?: string[];
  isAdult?: boolean;
  access?: import("./types").ViewerAccess;
  isFeatured?: boolean;
  episodeCount?: number;
  duration?: number;
  externalIds?: {
    imdb?: string;
    tmdb?: number;
    mal?: number;
    anilist?: number;
    kitsu?: string;
    tvmaze?: number;
  };
  playbackAvailability?: "available" | "unavailable" | "unknown";
  playbackAccess?: import("./types").PlaybackAccess;
  localization?: {
    requestedLocale: string;
    resolvedTitleLocale: string;
    resolvedDescriptionLocale?: string;
    titleFallback: boolean;
    descriptionFallback: boolean;
  };
}

export interface Episode {
  id: string;
  number: number;
  season?: number;
  title: string;
  description?: string;
  duration?: number;
  still?: string;
  stillCandidates?: string[];
  airDate?: string;
  embedUrl?: string;
}

export interface ContentDetail extends ContentItem {
  episodes?: Episode[];
  embedUrl?: string;
  cast?: string[];
  director?: string;
  trailer?: string;
  castCredits?: { personId: number; name: string; character?: string; image?: string }[];
  runtime?: number;
  status?: string;
  seasons?: EnrichedSeason[];
  characters?: CharacterInfo[];
  relations?: RelationInfo[];
  recommendations?: RecommendationInfo[];
  scores?: ScoreInfo[];
  sources?: EnrichedSources;
}

export interface CharacterInfo {
  name: string;
  image?: string;
  role?: string;
}

export interface RelationInfo {
  title: string;
  type: string;
  id: string;
}

export interface RecommendationInfo {
  title: string;
  id: string;
  poster?: string;
}

export interface ScoreInfo {
  provider: string;
  value: number;
}

export interface EnrichedSources {
  jikan?: boolean;
  anilist?: number;
  kitsu?: string;
  tvmaze?: number;
}

export interface EnrichedSeason {
  number: number;
  name?: string;
  episodeCount?: number;
  episodes?: Episode[];
}

export interface Comment {
  id: string;
  contentId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}

export interface Clip {
  token: string;
  contentId: string;
  contentType: ContentType;
  title: string;
  startTime: number;
  endTime: number;
  embedUrl?: string;
  episodeId?: string;
  season?: number;
  episode?: number;
  isAdult?: boolean;
  status?: import("./types").ClipJobStatus;
  progress?: number;
  downloadUrl?: string;
  mediaUrl?: string;
  expiresAt?: string;
}

export interface SearchResult {
  items: ContentItem[];
  total: number;
  query: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
