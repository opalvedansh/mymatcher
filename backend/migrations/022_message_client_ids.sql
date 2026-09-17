-- Client-generated message ids make chat sends idempotent: a client that
-- retries after a lost ack gets the stored message back instead of a copy.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_msg_id TEXT;

-- Partial, so existing rows (all NULL) cost nothing and old clients that send
-- no id are unaffected. Adding a nullable column and building this index on
-- the current table size is quick; at a much larger size, build it with
-- CREATE INDEX CONCURRENTLY outside a migration transaction instead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_sender_client_id
  ON messages (sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
