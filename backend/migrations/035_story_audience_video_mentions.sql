-- Migration 035: Close Friends, video stories and @mentions.
--
-- audience: 'close_friends' stories are shown only to the people on the
-- author's Close Friends list (and the author).
-- media_type / duration_ms: a story's media may be a video; its length sets
-- how long the story plays.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';
ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_audience_check;
ALTER TABLE stories ADD CONSTRAINT stories_audience_check CHECK (audience IN ('all', 'close_friends'));

ALTER TABLE stories ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';
ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_media_type_check;
ALTER TABLE stories ADD CONSTRAINT stories_media_type_check CHECK (media_type IN ('image', 'video'));

ALTER TABLE stories ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- Who each user has put on their Close Friends list. Only matches can see a
-- story at all, so the list is a subset of the user's matches.
CREATE TABLE IF NOT EXISTS close_friends (
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS close_friends_friend_idx ON close_friends (friend_id);

-- "X mentioned you in their story" notifications point at the story.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS story_id UUID
  REFERENCES stories(id) ON DELETE CASCADE;

-- Recreating this constraint has to carry every type already allowed (see 029).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'new_match', 'new_like', 'new_message', 'announcement',
    'post_like', 'post_comment', 'comment_reply', 'story_mention'
  ));
