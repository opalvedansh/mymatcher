-- Migration 025: In-app notification inbox (matches, likes, messages).
-- Push notifications are sent alongside; this table is what the bell shows.
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('new_match', 'new_like', 'new_message')),
  actor_id    TEXT        REFERENCES users(id) ON DELETE CASCADE,
  match_id    UUID        REFERENCES matches(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL DEFAULT '',
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

-- One unread "new message" item per conversation; later messages bump it.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_unread_message_idx
  ON notifications (user_id, match_id)
  WHERE type = 'new_message' AND read_at IS NULL;
