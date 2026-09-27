-- Migration 030: WhatsApp-style chat.
--
-- Attachments (photos, videos, voice notes, documents), replies, forwards,
-- edits, delete-for-everyone, delete-for-me, reactions, delivery receipts,
-- clear chat, mute, and last-seen presence.
--
-- Attachment metadata lives in messages.attachment as encrypted JSON, like
-- messages.content, so a copy of the database does not reveal file names.
-- The files themselves live in the private `chat-media` storage bucket and
-- are only ever served through short-lived signed URLs.

-- ── messages ─────────────────────────────────────────────────────
-- Constant defaults: adding these is a catalog change, not a table rewrite.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS kind         TEXT        NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS attachment   TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_id  UUID,
  ADD COLUMN IF NOT EXISTS forwarded    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_known;
ALTER TABLE messages ADD CONSTRAINT messages_kind_known
  CHECK (kind IN ('text', 'image', 'video', 'audio', 'document'));

-- Everything already stored was delivered; starting the receipt columns
-- empty would make the first reconnect "deliver" the whole history.
UPDATE messages SET delivered_at = COALESCE(read_at, created_at) WHERE delivered_at IS NULL;

-- Production's messages table lost its foreign keys (002 dropped the tables
-- it referenced with CASCADE), so deleting an account or a match left its
-- messages behind. NOT VALID skips checking old rows, so this cannot fail on
-- an orphan that already exists, but every new row and every delete from
-- now on is enforced and cascades.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'messages'::regclass AND contype = 'f' AND confrelid = 'matches'::regclass
  ) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_match_id_fkey
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'messages'::regclass AND contype = 'f' AND confrelid = 'users'::regclass
  ) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'messages'::regclass AND conname = 'messages_reply_to_id_fkey'
  ) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_reply_to_id_fkey
      FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Unread counts and delivery catch-up only look at the small unread and
-- undelivered slices, never the whole history.
CREATE INDEX IF NOT EXISTS idx_messages_unread      ON messages (match_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_undelivered ON messages (match_id) WHERE delivered_at IS NULL;

-- ── reactions: one per person per message, like WhatsApp ─────────
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      TEXT        NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- ── delete for me ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_hidden (
  user_id    TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  message_id UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

-- ── per-person conversation settings: clear chat, mute ───────────
CREATE TABLE IF NOT EXISTS chat_member_state (
  match_id    UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  cleared_at  TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

-- Supabase exposes the public schema over PostgREST with the app's anon key.
-- With RLS on and no policies only the backend (the table owner) can use
-- these tables.
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_hidden    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_member_state ENABLE ROW LEVEL SECURITY;

-- ── presence ─────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
