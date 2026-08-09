DO $$ BEGIN
  CREATE TYPE "reaction_type" AS ENUM('like', 'dislike');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "content_reactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" text,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "reaction" "reaction_type" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "content_reactions_content_idx" ON "content_reactions" ("content_type", "content_id");

CREATE UNIQUE INDEX IF NOT EXISTS "content_reactions_user_content_unique"
  ON "content_reactions" ("user_id", "content_type", "content_id")
  WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "content_reactions_session_content_unique"
  ON "content_reactions" ("session_id", "content_type", "content_id")
  WHERE "session_id" IS NOT NULL;
