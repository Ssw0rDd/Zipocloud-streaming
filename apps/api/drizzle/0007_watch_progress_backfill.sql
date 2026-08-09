WITH latest_progress AS (
  SELECT DISTINCT ON (
    CASE
      WHEN "user_id" IS NOT NULL THEN 'user:' || "user_id"
      ELSE 'session:' || "session_id"
    END,
    "content_type",
    "content_id",
    COALESCE("episode_id", '')
  )
    CASE
      WHEN "user_id" IS NOT NULL THEN 'user:' || "user_id"
      ELSE 'session:' || "session_id"
    END AS "owner_key",
    "user_id",
    CASE WHEN "user_id" IS NULL THEN "session_id" ELSE NULL END AS "session_id",
    "content_type",
    "content_id",
    COALESCE("episode_id", '') AS "episode_key",
    "episode_id",
    "duration_seconds",
    LEAST(
      COALESCE("progress_seconds", 0),
      COALESCE(NULLIF("duration_seconds", 0), "progress_seconds", 0)
    ) AS "progress_seconds",
    CASE
      WHEN "duration_seconds" > 0
        THEN "progress_seconds" >= "duration_seconds" * 0.95
      ELSE false
    END AS "completed",
    "viewed_at" AS "updated_at"
  FROM "content_views"
  WHERE "progress_seconds" IS NOT NULL
    AND ("user_id" IS NOT NULL OR "session_id" IS NOT NULL)
  ORDER BY
    "owner_key",
    "content_type",
    "content_id",
    "episode_key",
    "viewed_at" DESC
)
INSERT INTO "watch_progress" (
  "owner_key",
  "user_id",
  "session_id",
  "content_type",
  "content_id",
  "episode_key",
  "episode_id",
  "duration_seconds",
  "progress_seconds",
  "completed",
  "updated_at"
)
SELECT
  "owner_key",
  "user_id",
  "session_id",
  "content_type",
  "content_id",
  "episode_key",
  "episode_id",
  "duration_seconds",
  "progress_seconds",
  "completed",
  "updated_at"
FROM latest_progress
ON CONFLICT ("owner_key", "content_type", "content_id", "episode_key")
DO NOTHING;
