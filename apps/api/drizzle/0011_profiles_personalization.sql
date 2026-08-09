CREATE TABLE IF NOT EXISTS "viewer_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "avatar_key" text DEFAULT 'pistachio' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "viewer_profiles_user_idx" ON "viewer_profiles" ("user_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "viewer_profiles_one_default_uidx" ON "viewer_profiles" ("user_id") WHERE "is_default" = true;

ALTER TABLE "watch_progress" ADD COLUMN IF NOT EXISTS "profile_id" uuid REFERENCES "viewer_profiles"("id") ON DELETE cascade;

UPDATE "watch_progress"
SET "episode_key" = CASE
  WHEN "content_type" = 'movie' THEN 'movie'
  WHEN NULLIF("episode_id", '') IS NOT NULL THEN 'id:' || "episode_id"
  WHEN "episode_number" IS NOT NULL THEN 's:' || COALESCE("season_number", 1)::text || ':e:' || "episode_number"::text
  ELSE 'unknown'
END
WHERE "episode_key" = '';

CREATE INDEX IF NOT EXISTS "watch_progress_profile_updated_idx" ON "watch_progress" ("profile_id", "updated_at");

CREATE TABLE IF NOT EXISTS "watch_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" text NOT NULL UNIQUE,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "profile_id" uuid REFERENCES "viewer_profiles"("id") ON DELETE set null,
  "session_id" text,
  "event_type" text NOT NULL,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "episode_key" text DEFAULT 'movie' NOT NULL,
  "episode_id" text,
  "season_number" integer,
  "episode_number" integer,
  "progress_seconds" integer,
  "duration_seconds" integer,
  "metadata" jsonb,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "watch_events_profile_time_idx" ON "watch_events" ("profile_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "watch_events_user_time_idx" ON "watch_events" ("user_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "watch_events_content_time_idx" ON "watch_events" ("content_type", "content_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "recommendation_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "profile_id" uuid NOT NULL REFERENCES "viewer_profiles"("id") ON DELETE cascade,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "recommendation_feedback_profile_content_uidx" ON "recommendation_feedback" ("profile_id", "content_type", "content_id");

CREATE TABLE IF NOT EXISTS "legacy_history_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "profile_id" uuid NOT NULL REFERENCES "viewer_profiles"("id") ON DELETE cascade,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text DEFAULT 'processing' NOT NULL,
  "imported_count" integer DEFAULT 0 NOT NULL,
  "rejected_count" integer DEFAULT 0 NOT NULL,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_history_imports_user_key_uidx" ON "legacy_history_imports" ("user_id", "idempotency_key");
