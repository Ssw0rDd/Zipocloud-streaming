-- Support comments on series (and future content types) via content_type + content_id
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "content_type" text NOT NULL DEFAULT 'anime';
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "content_id" text;

UPDATE "comments" SET "content_id" = "anime_id"::text WHERE "content_id" IS NULL;

ALTER TABLE "comments" ALTER COLUMN "content_id" SET NOT NULL;
ALTER TABLE "comments" ALTER COLUMN "anime_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "comments_content_idx" ON "comments" ("content_type", "content_id");
