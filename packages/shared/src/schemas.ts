import { z } from "zod";
import { CONTENT_TYPES } from "./constants";

const commaSeparatedList = z.preprocess(
  (value) => typeof value === "string"
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : value,
  z.array(z.string().min(1).max(64)).max(20).default([]),
);

/** Avoid z.coerce.boolean — Boolean("false") === true. */
const queryBoolean = z.preprocess((value) => {
  if (value == null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return false;
}, z.boolean()).default(false);

export const contentTypeSchema = z.enum(CONTENT_TYPES);

export const catalogQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  includeAdult: queryBoolean,
  locale: z.string().max(10).optional(),
  genres: commaSeparatedList,
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: contentTypeSchema.optional(),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  includeAdult: queryBoolean,
  locale: z.string().max(10).optional(),
  genres: commaSeparatedList,
});

export const searchSuggestionsQuerySchema = z.object({
  q: z.string().min(1).max(120),
  type: contentTypeSchema.optional(),
  locale: z.string().max(10).optional(),
  genres: commaSeparatedList,
});

export const contentIdParamsSchema = z.object({
  type: contentTypeSchema,
  id: z.string().min(1).max(64),
});

export const embedParamsSchema = contentIdParamsSchema;

export const featuredQuerySchema = z.object({
  includeAdult: queryBoolean,
  locale: z.string().max(10).optional(),
});

export const recordViewBodySchema = z.object({
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
  episodeId: z.string().max(64).optional(),
  seasonNumber: z.number().int().min(1).max(10_000).optional(),
  episodeNumber: z.number().int().min(1).max(100_000).optional(),
  durationSeconds: z.number().int().min(0).max(31_536_000).optional(),
  progressSeconds: z.number().int().min(0).max(31_536_000).optional(),
  completed: z.boolean().optional(),
});

export const profileIdSchema = z.string().uuid();

export const createViewerProfileBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  avatarKey: z.string().trim().regex(/^[a-z0-9-]{1,32}$/).default("pistachio"),
});

export const updateViewerProfileBodySchema = createViewerProfileBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const recommendationEventTypeSchema = z.enum([
  "impression",
  "detail",
  "play",
  "qualified_play",
  "complete",
  "abandon",
  "like",
  "dislike",
  "list_add",
  "hide",
  "search",
  "mark_watched",
]);

export const recommendationEventBodySchema = z.object({
  eventId: z.string().trim().regex(/^[A-Za-z0-9_-]{12,80}$/),
  profileId: profileIdSchema.optional(),
  eventType: recommendationEventTypeSchema,
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
  episodeId: z.string().max(64).optional(),
  seasonNumber: z.number().int().min(1).max(10_000).optional(),
  episodeNumber: z.number().int().min(1).max(100_000).optional(),
  progressSeconds: z.number().int().min(0).max(31_536_000).optional(),
  durationSeconds: z.number().int().min(0).max(31_536_000).optional(),
  occurredAt: z.string().datetime().optional(),
  context: z.object({
    rail: z.string().trim().max(80).optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    query: z.string().trim().max(120).optional(),
  }).strict().optional(),
}).strict();

export const recommendationFeedbackBodySchema = z.object({
  profileId: profileIdSchema.optional(),
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
  action: z.enum(["hide", "not_for_me", "undo"]),
}).strict();

export const legacyHistoryItemSchema = z.object({
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
  episodeId: z.string().max(64).optional(),
  seasonNumber: z.number().int().min(1).max(10_000).optional(),
  episodeNumber: z.number().int().min(1).max(100_000).optional(),
  progressSeconds: z.number().int().min(0).max(31_536_000),
  durationSeconds: z.number().int().min(0).max(31_536_000).optional(),
  completed: z.boolean().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export const legacyHistoryImportBodySchema = z.object({
  profileId: profileIdSchema.optional(),
  items: z.array(legacyHistoryItemSchema).min(1).max(500),
}).strict();

export const createClipBodySchema = z.object({
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  startSeconds: z.number().int().min(0),
  endSeconds: z.number().int().min(1),
  episodeId: z.string().max(64).optional(),
  season: z.number().int().positive().max(10_000).optional(),
  episode: z.number().int().positive().max(100_000).optional(),
});

export const createPlaybackSessionBodySchema = z.object({
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
  episodeId: z.string().max(64).optional(),
  season: z.number().int().positive().max(10_000).optional(),
  episode: z.number().int().positive().max(100_000).optional(),
  audioLang: z.string().max(16).optional(),
  subtitleLang: z.string().max(16).optional(),
  preferredServerId: z.string().max(80).optional(),
});

export const selectPlaybackServerBodySchema = z.object({
  serverId: z.string().min(1).max(80),
});

export const createCinemaRoomBodySchema = createPlaybackSessionBodySchema
  .omit({ preferredServerId: true })
  .extend({ password: z.string().min(8).max(128).optional() });

export const joinCinemaRoomBodySchema = z.object({
  name: z.string().max(40).optional(),
  password: z.string().max(128).optional(),
});

export const cinemaPrintBodySchema = z.object({
  image: z.string().min(32).max(3_000_000),
  timestamp: z.number().finite().min(0).max(31_536_000),
});

export const adImpressionBodySchema = z.object({
  adUnitId: z.string().min(1).max(64),
  tier: z.enum(["free", "basic", "premium", "none"]),
  placement: z.string().min(1).max(64),
  contentType: contentTypeSchema.optional(),
  contentId: z.string().max(64).optional(),
});

export const createCommentBodySchema = z.object({
  body: z.string().min(1).max(2000),
  episodeNumber: z.number().int().min(0).optional(),
});

export const animeIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const seriesIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export const commentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const clipTokenParamsSchema = z.object({
  token: z.string().min(8).max(64),
});

export const adsConfigQuerySchema = z.object({
  tier: z.enum(["guest", "member", "supporter", "free", "basic", "premium", "none"]).optional(),
});

export const commentsQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const donateBodySchema = z.object({
  amount: z.number().min(1).max(10_000),
  currency: z.string().max(8).default("BRL"),
  message: z.string().max(500).optional(),
  anonymous: z.boolean().default(false),
});

export const reactionValueSchema = z.enum(["like", "dislike"]);

export const reactionActionSchema = z.enum(["like", "dislike", "remove"]);

export const reactionBodySchema = z.object({
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
  reaction: reactionActionSchema,
});

export const reactionParamsSchema = z.object({
  type: contentTypeSchema,
  id: z.string().min(1).max(64),
});

export const createPlaylistBodySchema = z.object({
  name: z.string().min(1).max(100),
});

export const updatePlaylistBodySchema = z.object({
  name: z.string().min(1).max(100),
});

export const playlistIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const playlistItemBodySchema = z.object({
  contentType: contentTypeSchema,
  contentId: z.string().min(1).max(64),
});

export const personalizedRecommendationsQuerySchema = z.object({
  includeAdult: queryBoolean,
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type RecordViewBody = z.infer<typeof recordViewBodySchema>;
export type CreateViewerProfileBody = z.infer<typeof createViewerProfileBodySchema>;
export type UpdateViewerProfileBody = z.infer<typeof updateViewerProfileBodySchema>;
export type RecommendationEventBody = z.infer<typeof recommendationEventBodySchema>;
export type RecommendationFeedbackBody = z.infer<typeof recommendationFeedbackBodySchema>;
export type LegacyHistoryItem = z.infer<typeof legacyHistoryItemSchema>;
export type LegacyHistoryImportBody = z.infer<typeof legacyHistoryImportBodySchema>;
export type CreateClipBody = z.infer<typeof createClipBodySchema>;
export type AdImpressionBody = z.infer<typeof adImpressionBodySchema>;
export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;
export type ReactionValue = z.infer<typeof reactionValueSchema>;
export type ReactionAction = z.infer<typeof reactionActionSchema>;
export type ReactionBody = z.infer<typeof reactionBodySchema>;
export type ReactionParams = z.infer<typeof reactionParamsSchema>;
export type CreatePlaylistBody = z.infer<typeof createPlaylistBodySchema>;
export type UpdatePlaylistBody = z.infer<typeof updatePlaylistBodySchema>;
export type PlaylistItemBody = z.infer<typeof playlistItemBodySchema>;
export type PersonalizedRecommendationsQuery = z.infer<
  typeof personalizedRecommendationsQuerySchema
>;
export type CreatePlaybackSessionBody = z.infer<typeof createPlaybackSessionBodySchema>;
export type CreateCinemaRoomBody = z.infer<typeof createCinemaRoomBodySchema>;
