-- ============================================================
-- Migration 037: Web Push Subscriptions
--
-- Browser push (VAPID) for the web app. Unlike the single
-- users.expo_push_token, a user can be signed in on several
-- browsers, so each subscription is its own row.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT        NOT NULL UNIQUE,
  p256dh       TEXT        NOT NULL,
  auth         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user ON web_push_subscriptions(user_id);

COMMIT;
