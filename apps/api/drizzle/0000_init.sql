CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "anime_id" integer NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "episode_number" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "comments_anime_id_idx" ON "comments" ("anime_id");
CREATE INDEX IF NOT EXISTS "comments_user_id_idx" ON "comments" ("user_id");

CREATE TABLE IF NOT EXISTS "clips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" text NOT NULL UNIQUE,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "title" text NOT NULL,
  "start_seconds" integer NOT NULL,
  "end_seconds" integer NOT NULL,
  "episode_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "clips_token_idx" ON "clips" ("token");

CREATE TABLE IF NOT EXISTS "content_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "episode_id" text,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "session_id" text,
  "duration_seconds" integer,
  "progress_seconds" integer,
  "viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "content_views_content_idx" ON "content_views" ("content_type", "content_id");
CREATE INDEX IF NOT EXISTS "content_views_viewed_at_idx" ON "content_views" ("viewed_at");

CREATE TABLE IF NOT EXISTS "ad_impressions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ad_unit_id" text NOT NULL,
  "tier" text NOT NULL,
  "placement" text NOT NULL,
  "content_type" text,
  "content_id" text,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "session_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ad_impressions_created_at_idx" ON "ad_impressions" ("created_at");
CREATE INDEX IF NOT EXISTS "ad_impressions_ad_unit_idx" ON "ad_impressions" ("ad_unit_id");

CREATE TABLE IF NOT EXISTS "donations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "provider" text,
  "provider_ref" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
