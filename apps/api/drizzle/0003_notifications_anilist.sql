-- Episode notification subscriptions
CREATE TABLE IF NOT EXISTS episode_notification_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL,
  last_notified_episode INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS episode_notification_subscriptions_user_idx
  ON episode_notification_subscriptions (user_id);

-- AniList OAuth tokens (optional sync)
CREATE TABLE IF NOT EXISTS user_anilist_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  anilist_user_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
