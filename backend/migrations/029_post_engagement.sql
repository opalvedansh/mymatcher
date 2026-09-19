-- 029_post_engagement.sql
-- Comments (one reply level), comment likes, share tracking, and the
-- engagement counters the ranked feed scores on.
--
-- Counters here are maintained by triggers rather than in app code (the way
-- posts.likes_count was). Cascades make app-level counters wrong: deleting a
-- user removes their post_likes rows without ever touching posts.likes_count,
-- so counts drift upward on every account deletion. Triggers see the cascade.
-- The backfill at the bottom repairs the drift that already accumulated.

-- ── Counters on posts ────────────────────────────────────────────────
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS shares_count   INTEGER NOT NULL DEFAULT 0;

-- ── Comments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id     UUID REFERENCES post_comments(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2200),
  likes_count   INTEGER NOT NULL DEFAULT 0,
  replies_count INTEGER NOT NULL DEFAULT 0,
  edited_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Top-level listing: newest-first within a post.
CREATE INDEX IF NOT EXISTS post_comments_top_idx
  ON post_comments (post_id, created_at DESC)
  WHERE parent_id IS NULL;

-- Reply listing: oldest-first under a parent (replies read as a conversation).
CREATE INDEX IF NOT EXISTS post_comments_replies_idx
  ON post_comments (parent_id, created_at)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS post_comments_user_idx ON post_comments (user_id);

-- Replies are capped at one level, and a reply must stay on its parent's post.
-- Without the post check, a client could reply with a parent_id belonging to a
-- different post and hang its comment off a thread it cannot see.
CREATE OR REPLACE FUNCTION post_comments_enforce_depth() RETURNS trigger AS $$
DECLARE
  parent_post   UUID;
  parent_parent UUID;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post_id, parent_id INTO parent_post, parent_parent
    FROM post_comments WHERE id = NEW.parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent comment % not found', NEW.parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'replies are limited to one level'
      USING ERRCODE = 'check_violation';
  END IF;
  IF parent_post <> NEW.post_id THEN
    RAISE EXCEPTION 'parent comment belongs to a different post'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_comments_depth ON post_comments;
CREATE TRIGGER post_comments_depth
  BEFORE INSERT OR UPDATE OF parent_id ON post_comments
  FOR EACH ROW EXECUTE FUNCTION post_comments_enforce_depth();

-- posts.comments_count counts every comment (replies included, as Instagram
-- does); post_comments.replies_count counts only a thread's own replies.
CREATE OR REPLACE FUNCTION post_comments_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    IF NEW.parent_id IS NOT NULL THEN
      UPDATE post_comments SET replies_count = replies_count + 1 WHERE id = NEW.parent_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- No-ops when the parent row is itself being cascaded away.
    UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    IF OLD.parent_id IS NOT NULL THEN
      UPDATE post_comments SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = OLD.parent_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_comments_count_sync ON post_comments;
CREATE TRIGGER post_comments_count_sync
  AFTER INSERT OR DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION post_comments_counts();

-- ── Comment likes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS comment_likes_user_idx ON comment_likes (user_id);

CREATE OR REPLACE FUNCTION comment_likes_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE post_comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE post_comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comment_likes_count_sync ON comment_likes;
CREATE TRIGGER comment_likes_count_sync
  AFTER INSERT OR DELETE ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION comment_likes_counts();

-- ── Post likes: move the counter onto a trigger ──────────────────────
-- The app-level CTE in postController stays correct on its own writes, so this
-- trigger would double-count it. The controller is updated in the same change
-- to plain INSERT/DELETE and read the count back.
CREATE OR REPLACE FUNCTION post_likes_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_likes_count_sync ON post_likes;
CREATE TRIGGER post_likes_count_sync
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION post_likes_counts();

-- Affinity reads "posts this user engaged with", which the (post_id, user_id)
-- primary key cannot serve.
CREATE INDEX IF NOT EXISTS post_likes_user_idx ON post_likes (user_id, created_at DESC);

-- ── Shares ───────────────────────────────────────────────────────────
-- user_id is nullable and ON DELETE SET NULL: a share is an engagement signal
-- about the post and stays meaningful after the sharer deletes their account.
CREATE TABLE IF NOT EXISTS post_shares (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel    TEXT NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'link', 'web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_shares_post_idx ON post_shares (post_id);
CREATE INDEX IF NOT EXISTS post_shares_user_idx ON post_shares (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION post_shares_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET shares_count = shares_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET shares_count = GREATEST(shares_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_shares_count_sync ON post_shares;
CREATE TRIGGER post_shares_count_sync
  AFTER INSERT OR DELETE ON post_shares
  FOR EACH ROW EXECUTE FUNCTION post_shares_counts();

-- ── Feed ranking support ─────────────────────────────────────────────
-- Keyset pagination orders by (score, id); the ranked candidate scan is bounded
-- by created_at, so it needs recency plus the author join key.
CREATE INDEX IF NOT EXISTS posts_created_id_idx ON posts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS posts_user_created_idx ON posts (user_id, created_at DESC);

-- ── Notifications for post engagement ────────────────────────────────
-- Recreating this constraint has to carry every type already allowed, not just
-- the ones 025 declared: 028 widened it for 'announcement', which the admin
-- verification and broadcast flows insert.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'new_match', 'new_like', 'new_message', 'announcement',
    'post_like', 'post_comment', 'comment_reply'
  ));

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS post_id UUID
  REFERENCES posts(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS comment_id UUID
  REFERENCES post_comments(id) ON DELETE CASCADE;

-- ── Backfill ─────────────────────────────────────────────────────────
-- Repairs likes_count drift from past account deletions and seeds the new
-- counters. Safe to re-run: every value is recomputed from the source tables.
UPDATE posts p SET
  likes_count    = (SELECT count(*) FROM post_likes    pl WHERE pl.post_id = p.id),
  comments_count = (SELECT count(*) FROM post_comments pc WHERE pc.post_id = p.id),
  shares_count   = (SELECT count(*) FROM post_shares   ps WHERE ps.post_id = p.id);

UPDATE post_comments pc SET
  likes_count   = (SELECT count(*) FROM comment_likes  cl WHERE cl.comment_id = pc.id),
  replies_count = (SELECT count(*) FROM post_comments  r  WHERE r.parent_id  = pc.id);
