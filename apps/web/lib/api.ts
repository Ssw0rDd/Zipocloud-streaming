import type {
  LegacyContentDetail as ContentDetail,
  LegacyContentItem as ContentItem,
  Comment,
  Clip,
  ContentType,
  SearchResult,
  AggregatedManifest,
  AggregatorQuery,
  PlaybackSession,
  PlaybackBootstrap,
  SecureEmbedPlayback,
  CinemaMessage,
  CinemaParticipant,
  CinemaRoom,
  CinemaState,
  PlaybackIssueReport,
} from "@zipo/shared";
import { ApiClientError, apiFetch } from "./api-client";
import type { EmbedResponse } from "@/components/player/types";

export { apiFetch, API_URL } from "./api-client";

export type { ContentDetail, ContentItem, Comment, Clip, ContentType, SearchResult, AggregatedManifest, AggregatorQuery };

const V1 = "/api/v1";
const V2 = "/api/v2";
const V3 = "/api/v3";

export function getPosterUrl(item: { posterUrl?: string; poster?: string }) {
  return item.posterUrl ?? item.poster;
}

export function getBackdropUrl(item: { backdropUrl?: string; backdrop?: string }) {
  return item.backdropUrl ?? item.backdrop;
}

function mapApiItem(raw: Record<string, unknown>): ContentItem {
  return {
    id: String(raw.id),
    type: raw.type as ContentType,
    title: String(raw.title),
    originalTitle: raw.originalTitle as string | undefined,
    description: raw.description as string | undefined,
    posterUrl: (raw.posterUrl ?? raw.poster) as string | undefined,
    backdropUrl: (raw.backdropUrl ?? raw.backdrop) as string | undefined,
    posterCandidates: raw.posterCandidates as string[] | undefined,
    stillCandidates: raw.stillCandidates as string[] | undefined,
    year: raw.year as number | undefined,
    rating: raw.rating as number | undefined,
    genres: raw.genres as string[] | undefined,
    isAdult: Boolean(raw.isAdult),
    isFeatured: Boolean(raw.isFeatured),
    episodeCount: raw.episodeCount as number | undefined,
    duration: (raw.duration ?? raw.runtime) as number | undefined,
    externalIds: raw.externalIds as ContentItem["externalIds"],
    playbackAvailability:
      raw.playbackAvailability as ContentItem["playbackAvailability"],
    playbackAccess: raw.playbackAccess as ContentItem["playbackAccess"],
    localization: raw.localization as ContentItem["localization"],
    access: raw.access as ContentItem["access"],
  };
}

export interface FeaturedResponse {
  movies: ContentItem[];
  series: ContentItem[];
  anime: ContentItem[];
}

export interface HomeAggregateResponse {
  featured: FeaturedResponse & { source?: string };
  movies: { items: ContentItem[]; total: number };
  series: { items: ContentItem[]; total: number };
  anime: { items: ContentItem[]; total: number };
  locale: string;
  errors?: Partial<Record<"featured" | "movies" | "series" | "anime", string>>;
}

export interface CatalogResponse {
  type: ContentType;
  items: ContentItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface CommentsPage {
  data: Comment[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type ReactionType = "like" | "dislike";

export interface ReactionsSummary {
  likes: number;
  dislikes: number;
  userReaction: ReactionType | null;
}

export async function fetchFeatured(
  includeAdult = false,
  locale?: string,
): Promise<FeaturedResponse> {
  const params = new URLSearchParams({ includeAdult: String(includeAdult) });
  if (locale) params.set("locale", locale);
  const raw = await apiFetch<{
    movies: Record<string, unknown>[];
    series: Record<string, unknown>[];
    anime: Record<string, unknown>[];
  }>(`${V1}/featured?${params}`);

  return {
    movies: raw.movies.map(mapApiItem),
    series: raw.series.map(mapApiItem),
    anime: raw.anime.map(mapApiItem),
  };
}

type HomeAggregateRaw = {
  featured: {
    movies: Record<string, unknown>[];
    series: Record<string, unknown>[];
    anime: Record<string, unknown>[];
    source?: string;
  };
  movies: { items: Record<string, unknown>[]; total: number };
  series: { items: Record<string, unknown>[]; total: number };
  anime: { items: Record<string, unknown>[]; total: number };
  locale: string;
  errors?: HomeAggregateResponse["errors"];
};

type HomeDocumentV3Raw = {
  data: {
    featured: HomeAggregateRaw["featured"];
    sections: Array<{
      id: string;
      title?: string;
      type: string;
      items: Record<string, unknown>[];
      total?: number;
    }>;
  };
  meta?: {
    generatedAt?: string;
    stale?: boolean;
    partial?: boolean;
    cacheStatus?: string;
  };
  locale?: string;
  errors?: HomeAggregateResponse["errors"];
};

function mapHomeAggregate(raw: HomeAggregateRaw): HomeAggregateResponse {
  return {
    locale: raw.locale,
    errors: raw.errors,
    featured: {
      movies: raw.featured.movies.map(mapApiItem),
      series: raw.featured.series.map(mapApiItem),
      anime: raw.featured.anime.map(mapApiItem),
      source: raw.featured.source,
    },
    movies: {
      items: raw.movies.items.map(mapApiItem),
      total: raw.movies.total,
    },
    series: {
      items: raw.series.items.map(mapApiItem),
      total: raw.series.total,
    },
    anime: {
      items: raw.anime.items.map(mapApiItem),
      total: raw.anime.total,
    },
  };
}

function sectionKey(type: string): "movies" | "series" | "anime" | null {
  const normalized = type.toLowerCase();
  if (normalized === "movie" || normalized === "movies") return "movies";
  if (normalized === "series" || normalized === "tv" || normalized === "show") return "series";
  if (normalized === "anime") return "anime";
  return null;
}

function mapHomeDocumentV3(raw: HomeDocumentV3Raw, locale?: string): HomeAggregateResponse {
  const empty = { items: [] as ContentItem[], total: 0 };
  const buckets: Record<"movies" | "series" | "anime", { items: ContentItem[]; total: number }> = {
    movies: { ...empty },
    series: { ...empty },
    anime: { ...empty },
  };

  for (const section of raw.data.sections ?? []) {
    const key = sectionKey(section.type) ?? sectionKey(section.id);
    if (!key) continue;
    buckets[key] = {
      items: section.items.map(mapApiItem),
      total: section.total ?? section.items.length,
    };
  }

  const featured = raw.data.featured;
  return {
    locale: raw.locale ?? locale ?? "en",
    errors: raw.errors,
    featured: {
      movies: (featured?.movies ?? []).map(mapApiItem),
      series: (featured?.series ?? []).map(mapApiItem),
      anime: (featured?.anime ?? []).map(mapApiItem),
      source: featured?.source,
    },
    movies: buckets.movies,
    series: buckets.series,
    anime: buckets.anime,
  };
}

function isHomeDocumentV3(raw: unknown): raw is HomeDocumentV3Raw {
  return Boolean(
    raw &&
      typeof raw === "object" &&
      "data" in raw &&
      raw.data &&
      typeof raw.data === "object" &&
      "sections" in (raw.data as object),
  );
}

export async function fetchHomeAggregated(locale?: string): Promise<HomeAggregateResponse> {
  const params = new URLSearchParams();
  if (locale) params.set("locale", locale);
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : "";

  try {
    const v3 = await apiFetch<HomeDocumentV3Raw | HomeAggregateRaw>(`${V3}/home${suffix}`);
    if (isHomeDocumentV3(v3)) return mapHomeDocumentV3(v3, locale);
    return mapHomeAggregate(v3);
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : 0;
    const canFallback = status === 0 || status === 404 || status === 501 || status === 503 || status >= 500;
    if (!canFallback) throw error;
  }

  const raw = await apiFetch<HomeAggregateRaw>(`${V2}/aggregate/home${suffix}`);
  return mapHomeAggregate(raw);
}

export async function fetchCatalog(
  type: ContentType,
  options?: { skip?: number; limit?: number; includeAdult?: boolean; locale?: string; genres?: string[] },
): Promise<CatalogResponse> {
  const params = new URLSearchParams();
  if (options?.skip != null) params.set("skip", String(options.skip));
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.includeAdult) params.set("includeAdult", "true");
  if (options?.locale) params.set("locale", options.locale);
  if (options?.genres?.length) params.set("genres", options.genres.join(","));

  const qs = params.toString();
  const raw = await apiFetch<{
    type: ContentType;
    items: Record<string, unknown>[];
    total: number;
    skip: number;
    limit: number;
  }>(`${V1}/catalog/${type}${qs ? `?${qs}` : ""}`);

  return {
    ...raw,
    items: raw.items.map(mapApiItem),
  };
}

/** @deprecated Use fetchCatalog or fetchFeatured */
export async function fetchContent(options?: {
  type?: ContentType;
  featured?: boolean;
  limit?: number;
}) {
  if (options?.featured) {
    const featured = await fetchFeatured();
    const all = [...featured.movies, ...featured.series, ...featured.anime];
    const items = options.limit ? all.slice(0, options.limit) : all;
    return { data: items, total: items.length, page: 1, limit: options.limit ?? 20 };
  }

  if (options?.type) {
    const catalog = await fetchCatalog(options.type, { limit: options.limit ?? 20 });
    return {
      data: catalog.items,
      total: catalog.total,
      page: 1,
      limit: catalog.limit,
    };
  }

  const catalog = await fetchCatalog("movie", { limit: options?.limit ?? 20 });
  return {
    data: catalog.items,
    total: catalog.total,
    page: 1,
    limit: catalog.limit,
  };
}

export async function fetchEmbed(
  type: ContentType,
  id: string,
  options?: {
    episodeId?: string;
    season?: number;
    episode?: number;
    audioLang?: string;
    subtitleLang?: string;
    signal?: AbortSignal;
  },
): Promise<EmbedResponse> {
  const params = new URLSearchParams();
  if (options?.episodeId) params.set("episodeId", options.episodeId);
  if (options?.season != null) params.set("season", String(options.season));
  if (options?.episode != null) params.set("episode", String(options.episode));
  if (options?.audioLang) params.set("audioLang", options.audioLang);
  if (options?.subtitleLang) params.set("subtitleLang", options.subtitleLang);
  const qs = params.toString();
  return apiFetch<EmbedResponse>(
    `${V1}/embed/${type}/${id}${qs ? `?${qs}` : ""}`,
    { signal: options?.signal },
  );
}

export async function fetchEpisodes(
  type: ContentType,
  id: string,
  options?: { includeImages?: boolean; locale?: string },
) {
  const params = new URLSearchParams();
  if (options?.includeImages != null) {
    params.set("images", String(options.includeImages));
  }
  if (options?.locale) params.set("locale", options.locale);
  const qs = params.toString();
  return apiFetch<{ type: ContentType; id: string; episodes: ContentDetail["episodes"] }>(
    `${V1}/content/${type}/${id}/episodes${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchAggregated(
  type: ContentType,
  id: string,
  options?: AggregatorQuery,
): Promise<AggregatedManifest> {
  const params = new URLSearchParams();
  if (options?.locale) params.set("locale", options.locale);
  if (options?.audioLang) params.set("audioLang", options.audioLang);
  if (options?.subtitleLang) params.set("subtitleLang", options.subtitleLang);
  if (options?.includePlayback != null) {
    params.set("includePlayback", String(options.includePlayback));
  }
  if (options?.season != null) params.set("season", String(options.season));
  if (options?.episode != null) params.set("episode", String(options.episode));

  const qs = params.toString();
  return apiFetch<AggregatedManifest>(
    `${V2}/aggregate/${type}/${id}${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchEnrichedContent(
  type: ContentType,
  id: string,
): Promise<ContentDetail> {
  const raw = await apiFetch<Record<string, unknown>>(`${V1}/content/${type}/${id}/enriched`);
  const detail = mapApiItem(raw) as ContentDetail;

  if (raw.characters) {
    detail.characters = raw.characters as ContentDetail["characters"];
  }
  if (raw.relations) {
    detail.relations = raw.relations as ContentDetail["relations"];
  }
  if (raw.recommendations) {
    detail.recommendations = raw.recommendations as ContentDetail["recommendations"];
  }
  if (raw.scores) {
    detail.scores = raw.scores as ContentDetail["scores"];
  }
  if (raw.sources) {
    detail.sources = raw.sources as ContentDetail["sources"];
  }
  if (raw.seasons) {
    detail.seasons = (raw.seasons as Array<Record<string, unknown>>).map((s) => ({
      number: Number(s.number),
      name: s.name as string | undefined,
      episodeCount: s.episodeCount as number | undefined,
      episodes: (s.episodes as Array<Record<string, unknown>> | undefined)?.map((ep) => ({
        id: String(ep.id),
        number: Number(ep.number),
        season: ep.season as number | undefined,
        title: String(ep.title ?? ""),
        description: ep.description as string | undefined,
        still: ep.still as string | undefined,
        stillCandidates: ep.stillCandidates as string[] | undefined,
        airDate: (ep.airDate ?? ep.aired) as string | undefined,
        duration: ep.runtime as number | undefined,
      })),
    }));
  }
  if (raw.episodes) {
    detail.episodes = (raw.episodes as Array<Record<string, unknown>>).map((ep) => ({
      id: String(ep.id),
      number: Number(ep.number),
      season: ep.season as number | undefined,
      title: String(ep.title ?? ""),
      description: ep.description as string | undefined,
      still: ep.still as string | undefined,
      stillCandidates: ep.stillCandidates as string[] | undefined,
      airDate: (ep.airDate ?? ep.aired) as string | undefined,
      duration: ep.runtime as number | undefined,
    }));
  }
  if (raw.trailer) {
    detail.trailer = String(raw.trailer);
  }
  if (raw.cast) {
    detail.cast = raw.cast as ContentDetail["cast"];
  }
  if (raw.castCredits) {
    detail.castCredits = raw.castCredits as ContentDetail["castCredits"];
  }
  if (raw.director) {
    const dir = raw.director;
    detail.director = Array.isArray(dir) ? dir.join(", ") : String(dir);
  }
  if (raw.runtime != null) {
    detail.duration = Number(raw.runtime);
  }

  return detail;
}

export async function fetchContentById(
  type: ContentType,
  id: string,
  locale?: string,
): Promise<ContentDetail> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const raw = await apiFetch<Record<string, unknown>>(`${V1}/content/${type}/${id}${qs}`);
  const detail = mapApiItem(raw) as ContentDetail;
  if (typeof raw.trailer === "string") detail.trailer = raw.trailer;
  return detail;
}

export async function searchContent(
  query: string,
  type?: ContentType,
  options?: { skip?: number; limit?: number; locale?: string; genres?: string[] },
): Promise<SearchResult> {
  if (!query.trim()) {
    return { items: [], total: 0, query };
  }

  const params = new URLSearchParams({ q: query.trim() });
  if (type) params.set("type", type);
  if (options?.skip != null) params.set("skip", String(options.skip));
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.locale) params.set("locale", options.locale);
  if (options?.genres?.length) params.set("genres", options.genres.join(","));

  const result = await apiFetch<{
    items: Record<string, unknown>[];
    total: number;
    query: string;
  }>(`${V1}/search?${params}`);

  return {
    items: result.items.map(mapApiItem),
    total: result.total,
    query: result.query,
  };
}

export async function fetchComments(
  contentType: "anime" | "series",
  contentId: string,
  options?: { cursor?: string; limit?: number },
): Promise<CommentsPage> {
  const params = new URLSearchParams({ limit: String(options?.limit ?? 20) });
  if (options?.cursor) params.set("cursor", options.cursor);

  return apiFetch<CommentsPage>(
    `${V1}/${contentType}/${encodeURIComponent(contentId)}/comments?${params}`,
  );
}

export async function fetchAnimeComments(
  animeId: number,
  options?: { cursor?: string; limit?: number },
): Promise<CommentsPage> {
  return fetchComments("anime", String(animeId), options);
}

export async function fetchSeriesComments(
  seriesId: string,
  options?: { cursor?: string; limit?: number },
): Promise<CommentsPage> {
  return fetchComments("series", seriesId, options);
}

export async function postComment(
  contentType: "anime" | "series",
  contentId: string,
  body: string,
  episodeNumber?: number,
): Promise<Comment> {
  return apiFetch<Comment>(
    `${V1}/${contentType}/${encodeURIComponent(contentId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body, episodeNumber }),
    },
  );
}

export async function postAnimeComment(
  animeId: number,
  body: string,
  episodeNumber?: number,
): Promise<Comment> {
  return postComment("anime", String(animeId), body, episodeNumber);
}

export async function postSeriesComment(
  seriesId: string,
  body: string,
  episodeNumber?: number,
): Promise<Comment> {
  return postComment("series", seriesId, body, episodeNumber);
}

export async function deleteComment(commentId: string): Promise<void> {
  await apiFetch(`${V1}/comments/${commentId}`, { method: "DELETE" });
}

export async function fetchClip(token: string): Promise<Clip> {
  return apiFetch<Clip & { shareUrl?: string }>(`${V1}/clips/${token}`);
}

export async function createClip(body: {
  contentId: string;
  contentType: ContentType;
  title: string;
  startSeconds: number;
  endSeconds: number;
  episodeId?: string;
  season?: number;
  episode?: number;
}): Promise<Clip & { shareUrl: string }> {
  return apiFetch(`${V1}/clips`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchReactions(
  contentType: ContentType,
  contentId: string,
): Promise<ReactionsSummary> {
  const raw = await apiFetch<{
    likes: number;
    dislikes: number;
    userReaction?: ReactionType;
  }>(`${V1}/reactions/${contentType}/${contentId}`);

  return {
    likes: raw.likes,
    dislikes: raw.dislikes,
    userReaction: raw.userReaction ?? null,
  };
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

export interface PersonCredit {
  showName: string;
  character?: string;
}

export async function fetchPerson(id: number): Promise<PersonDetail> {
  return apiFetch<PersonDetail>(`${V1}/person/${id}`);
}

export async function fetchPersonCredits(
  id: number,
): Promise<{ credits: PersonCredit[] }> {
  return apiFetch<{ credits: PersonCredit[] }>(`${V1}/person/${id}/credits`);
}

export async function setReaction(
  contentType: ContentType,
  contentId: string,
  reaction: ReactionType | null,
): Promise<ReactionsSummary> {
  return apiFetch<ReactionsSummary>(`${V1}/reactions`, {
    method: "POST",
    body: JSON.stringify({
      contentType,
      contentId,
      reaction: reaction ?? "remove",
    }),
  });
}

export interface PlaylistSummary {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemEntry {
  id: string;
  contentType: ContentType;
  contentId: string;
  addedAt: string;
  content: ContentItem | null;
}

export interface PlaylistDetail extends Omit<PlaylistSummary, "itemCount"> {
  items: PlaylistItemEntry[];
}

export interface PersonalizedRecommendationsResponse {
  items: ContentItem[];
  source: "personalized" | "trending";
  personalized: boolean;
}

export async function recordView(body: {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  durationSeconds?: number;
  progressSeconds?: number;
  completed?: boolean;
}, options?: { keepalive?: boolean }): Promise<void> {
  await apiFetch(`${V1}/views`, {
    method: "POST",
    body: JSON.stringify(body),
    keepalive: options?.keepalive,
  });
}

export interface ViewProgress {
  episodeId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  viewedAt: string | null;
}

export async function fetchViewProgress(
  contentType: ContentType,
  contentId: string,
): Promise<ViewProgress | null> {
  const raw = await apiFetch<{ progress: ViewProgress | null }>(
    `${V1}/views/progress/${contentType}/${contentId}`,
  );
  return raw.progress;
}

export async function fetchPlaylists(): Promise<{ data: PlaylistSummary[] }> {
  return apiFetch(`${V1}/playlists`);
}

export async function fetchPlaylist(id: string): Promise<PlaylistDetail> {
  return apiFetch(`${V1}/playlists/${id}`);
}

export async function createPlaylist(name: string): Promise<PlaylistSummary> {
  return apiFetch(`${V1}/playlists`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function renamePlaylist(
  id: string,
  name: string,
): Promise<{ id: string; name: string; updatedAt: string }> {
  return apiFetch(`${V1}/playlists/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deletePlaylist(id: string): Promise<void> {
  await apiFetch(`${V1}/playlists/${id}`, { method: "DELETE" });
}

export async function addToPlaylist(
  playlistId: string,
  contentType: ContentType,
  contentId: string,
): Promise<{ id: string; added: boolean }> {
  return apiFetch(`${V1}/playlists/${playlistId}/items`, {
    method: "POST",
    body: JSON.stringify({ contentType, contentId }),
  });
}

export async function removeFromPlaylist(
  playlistId: string,
  contentType: ContentType,
  contentId: string,
): Promise<void> {
  await apiFetch(`${V1}/playlists/${playlistId}/items`, {
    method: "DELETE",
    body: JSON.stringify({ contentType, contentId }),
  });
}

export async function fetchPersonalizedRecommendations(
  options?: { includeAdult?: boolean; limit?: number },
): Promise<PersonalizedRecommendationsResponse> {
  const params = new URLSearchParams();
  if (options?.includeAdult) params.set("includeAdult", "true");
  if (options?.limit != null) params.set("limit", String(options.limit));
  const qs = params.toString();

  const raw = await apiFetch<{
    items: Record<string, unknown>[];
    source: "personalized" | "trending";
    personalized: boolean;
  }>(`${V1}/recommendations/personalized${qs ? `?${qs}` : ""}`);

  return {
    ...raw,
    items: raw.items.map(mapApiItem),
  };
}

export interface ContinueWatchingItem {
  contentType: string;
  contentId: string;
  episodeId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressSeconds: number;
  durationSeconds: number | null;
  viewedAt: string;
}

export interface EnrichedContinueWatchingItem extends ContinueWatchingItem {
  title: string;
  poster?: string;
  episodes?: ContentDetail["episodes"];
}

export async function fetchContinueWatching(
  locale?: string,
): Promise<{ items: EnrichedContinueWatchingItem[] }> {
  const params = new URLSearchParams();
  if (locale) params.set("locale", locale);
  const qs = params.toString();
  return apiFetch(`${V1}/views/continue/enriched${qs ? `?${qs}` : ""}`);
}

export async function resolvePlayback(body: {
  type: ContentType;
  id: string;
  season?: number;
  episode?: number;
  providerId: string;
  audioLang?: string;
  subtitleLang?: string;
}, options?: { signal?: AbortSignal }): Promise<{ sources: EmbedResponse["sources"] }> {
  return apiFetch(`${V1}/playback/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export async function fetchSearchSuggestions(
  query: string,
  options?: { type?: ContentType; locale?: string; genres?: string[]; signal?: AbortSignal },
): Promise<{ items: ContentItem[]; partial: boolean; cached: boolean; elapsedMs: number }> {
  const params = new URLSearchParams({ q: query.trim() });
  if (options?.type) params.set("type", options.type);
  if (options?.locale) params.set("locale", options.locale);
  if (options?.genres?.length) params.set("genres", options.genres.join(","));
  const raw = await apiFetch<{
    items: Record<string, unknown>[];
    partial: boolean;
    cached: boolean;
    elapsedMs: number;
  }>(`${V1}/search/suggestions?${params}`, { signal: options?.signal });
  return { ...raw, items: raw.items.map(mapApiItem) };
}

export interface PlaybackRequest {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  season?: number;
  episode?: number;
  audioLang?: string;
  subtitleLang?: string;
  preferredServerId?: string;
}

export async function createPlaybackSession(body: PlaybackRequest, options?: { signal?: AbortSignal }): Promise<PlaybackSession> {
  return apiFetch(`${V1}/playback/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export async function createPlaybackBootstrap(body: PlaybackRequest, options?: { signal?: AbortSignal }): Promise<PlaybackBootstrap> {
  return apiFetch(`${V2}/playback/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export async function fetchPlaybackEmbeds(
  body: PlaybackRequest,
  options?: { signal?: AbortSignal },
): Promise<{ embeds: SecureEmbedPlayback[] }> {
  return apiFetch(`${V2}/playback/embeds`, {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export async function fetchPlaybackPreparation(
  preparationId: string,
  options?: { signal?: AbortSignal },
): Promise<PlaybackBootstrap> {
  return apiFetch(`${V2}/playback/preparations/${encodeURIComponent(preparationId)}`, {
    signal: options?.signal,
  });
}

export async function selectPlaybackServer(
  sessionId: string,
  sessionToken: string,
  serverId: string,
  options?: { signal?: AbortSignal },
): Promise<PlaybackSession> {
  return apiFetch(`${V1}/playback/sessions/${sessionId}/select`, {
    method: "POST",
    headers: { "X-Playback-Session-Token": sessionToken },
    body: JSON.stringify({ serverId }),
    signal: options?.signal,
  });
}

export interface ViewerProfile {
  id: string;
  userId: string;
  name: string;
  avatarKey: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ViewerProfilesResponse {
  profiles: ViewerProfile[];
  limit: number;
  remaining: number;
}

export async function fetchViewerProfiles(): Promise<ViewerProfilesResponse> {
  return apiFetch(`${V2}/profiles`);
}

export async function createViewerProfile(input: {
  name: string;
  avatarKey?: string;
}): Promise<{ profile: ViewerProfile }> {
  return apiFetch(`${V2}/profiles`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateViewerProfile(
  profileId: string,
  input: { name?: string; avatarKey?: string },
): Promise<{ profile: ViewerProfile }> {
  return apiFetch(`${V2}/profiles/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteViewerProfile(profileId: string): Promise<void> {
  await apiFetch(`${V2}/profiles/${profileId}`, { method: "DELETE" });
}

export interface LegacyHistoryItem {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  progressSeconds: number;
  durationSeconds?: number;
  completed?: boolean;
  updatedAt?: string;
}

export async function importLegacyHistory(
  items: LegacyHistoryItem[],
  idempotencyKey: string,
): Promise<{ profileId: string; importedCount: number; replayed: boolean }> {
  return apiFetch(`${V2}/history/import`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ items }),
  });
}

export interface HistoryItem {
  contentType: ContentType;
  contentId: string;
  episodeId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  progressPct: number;
  updatedAt: string;
  title: string;
  poster?: string;
}

export async function fetchWatchHistory(
  locale?: string,
  limit = 60,
): Promise<{ profileId: string; items: HistoryItem[] }> {
  const params = new URLSearchParams();
  if (locale) params.set("locale", locale);
  params.set("limit", String(limit));
  const qs = params.toString();
  return apiFetch(`${V2}/history?${qs}`);
}

export async function deleteWatchHistoryItem(
  contentType: ContentType,
  contentId: string,
): Promise<void> {
  await apiFetch(`${V2}/history/${contentType}/${encodeURIComponent(contentId)}`, {
    method: "DELETE",
  });
}

export interface PersonalizedHomeProgress {
  episodeId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressSeconds: number;
  durationSeconds: number | null;
  updatedAt: string;
}

export interface PersonalizedHomeSection {
  id: string;
  title: string;
  layout: "landscape" | "poster" | "ranked";
  items: Array<ContentItem & { progress?: PersonalizedHomeProgress }>;
}

export interface PersonalizedHomeResponse {
  profileId: string | null;
  personalized: boolean;
  hero: ContentItem | null;
  sections: PersonalizedHomeSection[];
  reasons: Record<string, string>;
}

export async function fetchPersonalizedHome(locale?: string): Promise<PersonalizedHomeResponse> {
  const params = new URLSearchParams();
  if (locale) params.set("locale", locale);
  const raw = await apiFetch<{
    profileId: string | null;
    personalized: boolean;
    hero: Record<string, unknown> | null;
    sections: Array<{
      id: string;
      title: string;
      layout: "landscape" | "poster" | "ranked";
      items: Array<Record<string, unknown> & { progress?: PersonalizedHomeProgress }>;
    }>;
    reasons: Record<string, string>;
  }>(`${V2}/home?${params}`);
  return {
    ...raw,
    hero: raw.hero ? mapApiItem(raw.hero) : null,
    sections: raw.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({ ...mapApiItem(item), progress: item.progress })),
    })),
  };
}

export async function recordRecommendationEvent(input: {
  eventType: "impression" | "detail" | "play" | "hide";
  contentType: ContentType;
  contentId: string;
  rail?: string;
  position?: number;
}): Promise<void> {
  await apiFetch(`${V2}/recommendation-events`, {
    method: "POST",
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: input.eventType,
      contentType: input.contentType,
      contentId: input.contentId,
      context: { rail: input.rail, position: input.position },
    }),
  });
}

export async function submitRecommendationFeedback(input: {
  contentType: ContentType;
  contentId: string;
  action: "hide" | "not_for_me" | "undo";
}): Promise<void> {
  await apiFetch(`${V2}/recommendations/${encodeURIComponent(`${input.contentType}:${input.contentId}`)}/feedback`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface SupporterPaymentConfig {
  enabled: boolean;
  amountCents: number | null;
  currency: "BRL";
  entitlement: "lifetime_supporter";
}

export interface SupporterPixOrder {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  statusDetail: string | null;
  ticketUrl: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSupporterPaymentConfig(): Promise<SupporterPaymentConfig> {
  return apiFetch(`${V1}/donate/config`);
}

export async function createSupporterPixOrder(idempotencyKey: string): Promise<{ order: SupporterPixOrder }> {
  return apiFetch(`${V1}/donate/pix`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export async function fetchSupporterPixOrder(orderId: string): Promise<{ order: SupporterPixOrder }> {
  return apiFetch(`${V1}/donate/orders/${orderId}`);
}

export async function refreshPlaybackSession(
  sessionId: string,
  sessionToken: string,
  options?: { signal?: AbortSignal },
): Promise<PlaybackSession> {
  return apiFetch(`${V1}/playback/sessions/${sessionId}/refresh`, {
    method: "POST",
    headers: { "X-Playback-Session-Token": sessionToken },
    signal: options?.signal,
  });
}

export async function reportPlaybackIssue(
  body: PlaybackIssueReport,
): Promise<{ reported: true; reportId: string }> {
  return apiFetch("/api/v1/playback/reports", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface CinemaJoinResponse {
  room: CinemaRoom;
  participant: CinemaParticipant;
  state: CinemaState;
  participants?: CinemaParticipant[];
  accessToken: string;
  wsTicket: string;
}

export interface PublicFeatures {
  cinemaEnabled: boolean;
  embedCinemaChatOnly: boolean;
  playbackV2Enabled: boolean;
  nativePlayerOnly: boolean;
  mediaWorkerEnabled: boolean;
  adsEnabled: boolean;
  pwaEnabled: boolean;
}

export async function fetchPublicFeatures(): Promise<PublicFeatures> {
  return apiFetch(`${V1}/features`);
}

export async function createCinemaRoomRequest(body: {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  season?: number;
  episode?: number;
  password?: string;
}): Promise<CinemaJoinResponse> {
  return apiFetch(`${V1}/cinema/rooms`, { method: "POST", body: JSON.stringify(body) });
}

export async function fetchCinemaRoom(token: string): Promise<{
  token: string;
  contentType: ContentType;
  contentId: string;
  hasPassword: boolean;
  isAdult: boolean;
  participantCount: number;
  maxParticipants: number;
  expiresAt: string;
  embedCinemaChatOnly?: boolean;
}> {
  return apiFetch(`${V1}/cinema/rooms/${token}`);
}

export async function joinCinemaRoomRequest(
  token: string,
  body: { name?: string; password?: string },
): Promise<CinemaJoinResponse> {
  return apiFetch(`${V1}/cinema/rooms/${token}/join`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function refreshCinemaTicket(token: string, accessToken: string) {
  return apiFetch<{ wsTicket: string }>(`${V1}/cinema/rooms/${token}/tickets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function fetchCinemaMessages(token: string, accessToken: string) {
  return apiFetch<{ messages: CinemaMessage[] }>(`${V1}/cinema/rooms/${token}/messages`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function uploadCinemaPrint(
  token: string,
  accessToken: string,
  image: string,
  timestamp: number,
) {
  return apiFetch<{ message: CinemaMessage }>(`${V1}/cinema/rooms/${token}/prints`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ image, timestamp }),
  });
}

export async function fetchAnilistStatus(): Promise<{ connected: boolean }> {
  return apiFetch(`${V1}/anilist/status`);
}

export async function fetchAnilistAuthUrl(): Promise<{ url: string }> {
  return apiFetch(`${V1}/anilist/auth`);
}

export async function disconnectAnilist(): Promise<{ connected: false }> {
  return apiFetch(`${V1}/anilist/connection`, { method: "DELETE" });
}

export async function subscribeEpisodeNotifications(
  animeId: string,
): Promise<{ subscribed: boolean }> {
  return apiFetch(`${V1}/notifications/anime/${animeId}/subscribe`, {
    method: "POST",
  });
}

export async function unsubscribeEpisodeNotifications(
  animeId: string,
): Promise<{ subscribed: boolean }> {
  return apiFetch(`${V1}/notifications/anime/${animeId}/subscribe`, {
    method: "DELETE",
  });
}

export async function fetchEpisodeNotificationSubscriptions(): Promise<{
  subscriptions: string[];
}> {
  return apiFetch(`${V1}/notifications/anime`);
}
