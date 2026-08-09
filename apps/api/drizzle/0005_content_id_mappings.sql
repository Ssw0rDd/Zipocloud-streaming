CREATE TABLE IF NOT EXISTS "content_id_mappings" (
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "tmdb_id" integer,
  "status" text NOT NULL,
  "match_method" text NOT NULL,
  "confidence" real DEFAULT 0 NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_id_mappings_content_type_content_id_pk"
    PRIMARY KEY ("content_type", "content_id")
);
CREATE INDEX IF NOT EXISTS "content_id_mappings_tmdb_idx"
  ON "content_id_mappings" ("tmdb_id");
CREATE INDEX IF NOT EXISTS "content_id_mappings_status_idx"
  ON "content_id_mappings" ("status");
