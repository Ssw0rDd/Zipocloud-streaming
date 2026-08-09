CREATE TABLE IF NOT EXISTS "playlists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "playlists_user_id_idx" ON "playlists" ("user_id");

CREATE TABLE IF NOT EXISTS "playlist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playlist_id" uuid NOT NULL REFERENCES "playlists"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "playlist_items_playlist_id_idx" ON "playlist_items" ("playlist_id");
CREATE INDEX IF NOT EXISTS "playlist_items_user_id_idx" ON "playlist_items" ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "playlist_items_unique"
  ON "playlist_items" ("playlist_id", "content_type", "content_id");

CREATE INDEX IF NOT EXISTS "content_views_user_id_idx" ON "content_views" ("user_id");
