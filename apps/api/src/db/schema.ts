import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  index,
  jsonb,
  pgEnum,
  uniqueIndex,
  primaryKey,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Better Auth user table */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isSupporter: boolean("is_supporter").notNull().default(false),
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const viewerProfiles = pgTable(
  "viewer_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    avatarKey: text("avatar_key").notNull().default("pistachio"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("viewer_profiles_user_idx").on(table.userId, table.createdAt),
    uniqueIndex("viewer_profiles_one_default_uidx")
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentType: text("content_type").notNull().default("anime"),
    contentId: text("content_id").notNull(),
    animeId: integer("anime_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    episodeNumber: integer("episode_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("comments_content_idx").on(table.contentType, table.contentId),
    index("comments_anime_id_idx").on(table.animeId),
    index("comments_user_id_idx").on(table.userId),
  ],
);

export const clips = pgTable(
  "clips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    title: text("title").notNull(),
    startSeconds: integer("start_seconds").notNull(),
    endSeconds: integer("end_seconds").notNull(),
    episodeId: text("episode_id"),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    isAdult: boolean("is_adult").notNull().default(false),
    status: text("status").notNull().default("queued"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clips_token_idx").on(table.token),
    index("clips_expires_at_idx").on(table.expiresAt),
  ],
);

export const cinemaRooms = pgTable(
  "cinema_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    episodeId: text("episode_id"),
    playbackServerId: text("playback_server_id"),
    passwordHash: text("password_hash"),
    isAdult: boolean("is_adult").notNull().default(false),
    maxParticipants: integer("max_participants").notNull().default(50),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("cinema_rooms_token_idx").on(table.token),
    index("cinema_rooms_expires_at_idx").on(table.expiresAt),
  ],
);

export const clipJobs = pgTable(
  "clip_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clips.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (table) => [
    index("clip_jobs_status_idx").on(table.status, table.createdAt),
    index("clip_jobs_user_status_idx").on(table.userId, table.status),
    uniqueIndex("clip_jobs_one_active_uidx")
      .on(table.clipId)
      .where(sql`${table.status} in ('queued', 'processing')`),
  ],
);

export const mediaAttachments = pgTable(
  "media_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").references(() => cinemaRooms.id, { onDelete: "cascade" }),
    clipJobId: uuid("clip_job_id").references(() => clipJobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_attachments_room_idx").on(table.roomId),
    index("media_attachments_expires_at_idx").on(table.expiresAt),
  ],
);

export const cinemaMessages = pgTable(
  "cinema_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => cinemaRooms.id, { onDelete: "cascade" }),
    participantId: text("participant_id"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    participantName: text("participant_name").notNull(),
    guest: boolean("guest").notNull().default(true),
    type: text("type").notNull(),
    status: text("status").notNull().default("ready"),
    body: text("body"),
    attachmentId: uuid("attachment_id").references(() => mediaAttachments.id, {
      onDelete: "set null",
    }),
    clientMessageId: text("client_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("cinema_messages_room_created_idx").on(table.roomId, table.createdAt),
    uniqueIndex("cinema_messages_replay_uidx")
      .on(table.roomId, table.participantId, table.clientMessageId)
      .where(sql`${table.clientMessageId} IS NOT NULL`),
  ],
);

export const cinemaBans = pgTable(
  "cinema_bans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => cinemaRooms.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
    reason: text("reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("cinema_bans_room_subject_uidx").on(table.roomId, table.subjectKey)],
);

export const contentViews = pgTable(
  "content_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    episodeId: text("episode_id"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: text("session_id"),
    durationSeconds: integer("duration_seconds"),
    progressSeconds: integer("progress_seconds"),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("content_views_content_idx").on(table.contentType, table.contentId),
    index("content_views_viewed_at_idx").on(table.viewedAt),
    index("content_views_user_id_idx").on(table.userId),
  ],
);

export const watchProgress = pgTable(
  "watch_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerKey: text("owner_key").notNull(),
    profileId: uuid("profile_id").references(() => viewerProfiles.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    episodeKey: text("episode_key").notNull().default(""),
    episodeId: text("episode_id"),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    durationSeconds: integer("duration_seconds"),
    progressSeconds: integer("progress_seconds").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("watch_progress_owner_content_episode_uidx").on(
      table.ownerKey,
      table.contentType,
      table.contentId,
      table.episodeKey,
    ),
    index("watch_progress_owner_updated_idx").on(table.ownerKey, table.updatedAt),
    index("watch_progress_user_id_idx").on(table.userId),
    index("watch_progress_profile_updated_idx").on(table.profileId, table.updatedAt),
  ],
);

export const watchEvents = pgTable(
  "watch_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull().unique(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    profileId: uuid("profile_id").references(() => viewerProfiles.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id"),
    eventType: text("event_type").notNull(),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    episodeKey: text("episode_key").notNull().default("movie"),
    episodeId: text("episode_id"),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    progressSeconds: integer("progress_seconds"),
    durationSeconds: integer("duration_seconds"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("watch_events_profile_time_idx").on(table.profileId, table.occurredAt),
    index("watch_events_user_time_idx").on(table.userId, table.occurredAt),
    index("watch_events_content_time_idx").on(
      table.contentType,
      table.contentId,
      table.occurredAt,
    ),
  ],
);

export const recommendationFeedback = pgTable(
  "recommendation_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => viewerProfiles.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("recommendation_feedback_profile_content_uidx").on(
      table.profileId,
      table.contentType,
      table.contentId,
    ),
  ],
);

export const legacyHistoryImports = pgTable(
  "legacy_history_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => viewerProfiles.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("processing"),
    importedCount: integer("imported_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("legacy_history_imports_user_key_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
  ],
);

export const adImpressions = pgTable(
  "ad_impressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adUnitId: text("ad_unit_id").notNull(),
    tier: text("tier").notNull(),
    placement: text("placement").notNull(),
    contentType: text("content_type"),
    contentId: text("content_id"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ad_impressions_created_at_idx").on(table.createdAt),
    index("ad_impressions_ad_unit_idx").on(table.adUnitId),
  ],
);

export const reactionTypeEnum = pgEnum("reaction_type", ["like", "dislike"]);

export const contentIdMappings = pgTable(
  "content_id_mappings",
  {
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    tmdbId: integer("tmdb_id"),
    status: text("status").notNull(),
    matchMethod: text("match_method").notNull(),
    confidence: real("confidence").notNull().default(0),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.contentType, table.contentId] }),
    index("content_id_mappings_tmdb_idx").on(table.tmdbId),
    index("content_id_mappings_status_idx").on(table.status),
  ],
);

export const contentReactions = pgTable(
  "content_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    reaction: reactionTypeEnum("reaction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("content_reactions_content_idx").on(
      table.contentType,
      table.contentId,
    ),
    uniqueIndex("content_reactions_user_content_unique")
      .on(table.userId, table.contentType, table.contentId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex("content_reactions_session_content_unique")
      .on(table.sessionId, table.contentType, table.contentId)
      .where(sql`${table.sessionId} IS NOT NULL`),
  ],
);

export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("playlists_user_id_idx").on(table.userId),
  ],
);

export const playlistItems = pgTable(
  "playlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playlistId: uuid("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("playlist_items_playlist_id_idx").on(table.playlistId),
    index("playlist_items_user_id_idx").on(table.userId),
    uniqueIndex("playlist_items_unique")
      .on(table.playlistId, table.contentType, table.contentId),
  ],
);

export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("BRL"),
  status: text("status").notNull().default("pending"),
  provider: text("provider"),
  providerRef: text("provider_ref"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("mercado_pago"),
    providerOrderId: text("provider_order_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    externalReference: text("external_reference").notNull().unique(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    status: text("status").notNull().default("creating"),
    statusDetail: text("status_detail"),
    ticketUrl: text("ticket_url"),
    qrCode: text("qr_code"),
    qrCodeBase64: text("qr_code_base64"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_orders_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("payment_orders_provider_order_uidx")
      .on(table.provider, table.providerOrderId)
      .where(sql`${table.providerOrderId} IS NOT NULL`),
    index("payment_orders_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentOrderId: uuid("payment_order_id").references(() => paymentOrders.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("mercado_pago"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    providerEventId: text("provider_event_id"),
    action: text("action").notNull(),
    dataId: text("data_id").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("payment_events_order_created_idx").on(table.paymentOrderId, table.createdAt)],
);

export const supporterEntitlements = pgTable(
  "supporter_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourcePaymentOrderId: uuid("source_payment_order_id")
      .notNull()
      .references(() => paymentOrders.id, { onDelete: "restrict" })
      .unique(),
    kind: text("kind").notNull().default("lifetime_supporter"),
    status: text("status").notNull().default("active"),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
  },
  (table) => [index("supporter_entitlements_user_status_idx").on(table.userId, table.status)],
);

export const episodeNotificationSubscriptions = pgTable(
  "episode_notification_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: text("content_id").notNull(),
    lastNotifiedEpisode: integer("last_notified_episode").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("episode_notification_subscriptions_user_idx").on(table.userId),
    uniqueIndex("episode_notification_subscriptions_unique").on(
      table.userId,
      table.contentId,
    ),
  ],
);

export const userAnilistTokens = pgTable("user_anilist_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  anilistUserId: integer("anilist_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type ViewerProfile = typeof viewerProfiles.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Clip = typeof clips.$inferSelect;
export type CinemaRoom = typeof cinemaRooms.$inferSelect;
export type CinemaMessage = typeof cinemaMessages.$inferSelect;
export type CinemaBan = typeof cinemaBans.$inferSelect;
export type ClipJob = typeof clipJobs.$inferSelect;
export type MediaAttachment = typeof mediaAttachments.$inferSelect;
export type ContentView = typeof contentViews.$inferSelect;
export type WatchEvent = typeof watchEvents.$inferSelect;
export type RecommendationFeedback = typeof recommendationFeedback.$inferSelect;
export type LegacyHistoryImport = typeof legacyHistoryImports.$inferSelect;
export type AdImpression = typeof adImpressions.$inferSelect;
export type Donation = typeof donations.$inferSelect;
export type PaymentOrder = typeof paymentOrders.$inferSelect;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type SupporterEntitlement = typeof supporterEntitlements.$inferSelect;
export type ContentReaction = typeof contentReactions.$inferSelect;
export type ReactionType = (typeof reactionTypeEnum.enumValues)[number];
export type Playlist = typeof playlists.$inferSelect;
export type PlaylistItem = typeof playlistItems.$inferSelect;
export type EpisodeNotificationSubscription =
  typeof episodeNotificationSubscriptions.$inferSelect;
export type UserAnilistToken = typeof userAnilistTokens.$inferSelect;
