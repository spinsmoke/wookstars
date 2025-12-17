-- D1 schema for WookStars (anonymous uploads)
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);