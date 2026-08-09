ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'queued' NOT NULL;
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "storage_key" text;
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "mime_type" text;
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "size_bytes" integer;
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL;
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "season_number" integer;
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "episode_number" integer;
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "is_adult" boolean DEFAULT false NOT NULL;
CREATE INDEX IF NOT EXISTS "clips_expires_at_idx" ON "clips" ("expires_at");

CREATE TABLE IF NOT EXISTS "cinema_rooms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" text NOT NULL UNIQUE,
  "host_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "season_number" integer,
  "episode_number" integer,
  "episode_id" text,
  "playback_server_id" text,
  "password_hash" text,
  "is_adult" boolean DEFAULT false NOT NULL,
  "max_participants" integer DEFAULT 50 NOT NULL,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cinema_rooms_token_idx" ON "cinema_rooms" ("token");
CREATE INDEX IF NOT EXISTS "cinema_rooms_expires_at_idx" ON "cinema_rooms" ("expires_at");

CREATE TABLE IF NOT EXISTS "clip_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clip_id" uuid NOT NULL REFERENCES "clips"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" text DEFAULT 'queued' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "error_code" text,
  "error_detail" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL
);
CREATE INDEX IF NOT EXISTS "clip_jobs_status_idx" ON "clip_jobs" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "clip_jobs_user_status_idx" ON "clip_jobs" ("user_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "clip_jobs_one_active_uidx" ON "clip_jobs" ("clip_id") WHERE "status" IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS "media_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid REFERENCES "cinema_rooms"("id") ON DELETE cascade,
  "clip_job_id" uuid REFERENCES "clip_jobs"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "storage_key" text NOT NULL UNIQUE,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "width" integer,
  "height" integer,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "media_attachments_room_idx" ON "media_attachments" ("room_id");
CREATE INDEX IF NOT EXISTS "media_attachments_expires_at_idx" ON "media_attachments" ("expires_at");

CREATE TABLE IF NOT EXISTS "cinema_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL REFERENCES "cinema_rooms"("id") ON DELETE cascade,
  "participant_id" text,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "participant_name" text NOT NULL,
  "guest" boolean DEFAULT true NOT NULL,
  "type" text NOT NULL,
  "status" text DEFAULT 'ready' NOT NULL,
  "body" text,
  "attachment_id" uuid REFERENCES "media_attachments"("id") ON DELETE set null,
  "client_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "cinema_messages_room_created_idx" ON "cinema_messages" ("room_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "cinema_messages_replay_uidx" ON "cinema_messages" ("room_id", "participant_id", "client_message_id") WHERE "client_message_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "cinema_bans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL REFERENCES "cinema_rooms"("id") ON DELETE cascade,
  "subject_key" text NOT NULL,
  "reason" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "cinema_bans_room_subject_uidx" ON "cinema_bans" ("room_id", "subject_key");
