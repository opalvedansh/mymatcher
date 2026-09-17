-- 021_trust_safety.sql
-- Blocking and content reports (App Store Guideline 1.2 for user-generated content).

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- The primary key serves "who did I block"; this serves "who blocked me".
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id, blocker_id);

CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kept when the reporter deletes their account; the report still needs review.
  reporter_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('user', 'post', 'story', 'message')),
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'harassment', 'fake_profile', 'other')),
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);
