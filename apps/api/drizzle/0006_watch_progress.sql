CREATE TABLE IF NOT EXISTS "watch_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_key" text NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" text,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "episode_key" text DEFAULT '' NOT NULL,
  "episode_id" text,
  "season_number" integer,
  "episode_number" integer,
  "duration_seconds" integer,
  "progress_seconds" integer DEFAULT 0 NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "watch_progress_owner_content_episode_uidx"
  ON "watch_progress" ("owner_key", "content_type", "content_id", "episode_key");
CREATE INDEX IF NOT EXISTS "watch_progress_owner_updated_idx"
  ON "watch_progress" ("owner_key", "updated_at");
CREATE INDEX IF NOT EXISTS "watch_progress_user_id_idx"
  ON "watch_progress" ("user_id");
