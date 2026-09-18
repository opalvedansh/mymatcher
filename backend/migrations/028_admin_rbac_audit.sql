-- Migration 028: DB-backed admin roles, an append-only audit trail, and the
-- columns and indexes the admin panel's queries need.
--
-- No BEGIN/COMMIT here: migrate.js already wraps every file in one transaction
-- (migrate.js:99). Nesting one commits the runner's transaction early and
-- leaves the _migrations INSERT outside it.
--
-- No CREATE INDEX CONCURRENTLY either, for the same reason — it cannot run
-- inside a transaction block. At current row counts every index below builds
-- in well under a second; the two on messages/swipes are BRIN precisely so
-- they stay cheap as those tables grow.

-- ── 1. Admin accounts ─────────────────────────────────────────────
-- Deliberately NO foreign key to users(id). An admin is a Supabase auth
-- identity; a users row means "onboarded as a brand or a creator", which a
-- staff member need never do. Tying the two would force every moderator
-- through the consumer onboarding flow just to be able to sign in.
CREATE TABLE IF NOT EXISTS admin_users (
  user_id     TEXT PRIMARY KEY,           -- Supabase auth uid
  email       TEXT,                       -- denormalised for display; auth is the source of truth
  role        TEXT NOT NULL,
  note        TEXT,
  created_by  TEXT,                       -- granting admin's uid, 'bootstrap', or 'cli:<user>'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft revoke: the row stays so admin_audit_log.admin_id always resolves to
  -- a name and a role, including for people who have since left.
  revoked_at  TIMESTAMPTZ,
  revoked_by  TEXT
);

-- TEXT + CHECK rather than an enum: the runner executes every file inside one
-- transaction, and ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction that created the type. Adding a role must not need two deploys.
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_known;
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_known
  CHECK (role IN ('superadmin', 'moderator', 'support', 'analyst'));

CREATE INDEX IF NOT EXISTS idx_admin_users_active
  ON admin_users (created_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users (lower(email));

-- ── 2. Audit log ──────────────────────────────────────────────────
-- BIGSERIAL, not UUID: append-only and read in time order, so a monotonic key
-- keeps the index dense and gives keyset pagination a free tiebreaker.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           BIGSERIAL   PRIMARY KEY,
  admin_id     TEXT        NOT NULL,
  admin_email  TEXT,                                    -- frozen at action time
  action       TEXT        NOT NULL,                    -- 'user.ban', 'messages.read', ...
  target_type  TEXT,                                    -- user|post|story|message|report|match|setting|admin|broadcast|rating
  target_id    TEXT,
  reason       TEXT,                                    -- operator-supplied; mandatory on destructive actions
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb, -- {before, after, params, count, ...}
  ip           INET,
  user_agent   TEXT,
  status       SMALLINT,                                -- HTTP status the action returned
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created  ON admin_audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin    ON admin_audit_log (admin_id, created_at DESC);
-- "everything this team has ever done to this user" — the support drawer.
CREATE INDEX IF NOT EXISTS idx_audit_target   ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_metadata ON admin_audit_log USING GIN (metadata jsonb_path_ops);

-- ── 3. Ban reasons and soft delete ────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS banned_reason TEXT,
  ADD COLUMN IF NOT EXISTS banned_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_by     TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ;

-- Existing bans have no recorded moment; updated_at is the closest truth.
UPDATE users SET banned_at = updated_at WHERE banned = true AND banned_at IS NULL;

-- ── 4. Verification reviewer ──────────────────────────────────────
-- 027 records when a verification was reviewed but not by whom.
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS verification_reviewed_by TEXT;

-- ── 5. Indexes the panel's queries need ───────────────────────────
-- Keyset pagination over users, and the signups time series.
CREATE INDEX IF NOT EXISTS idx_users_created_id   ON users (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_users_role_created ON users (role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_matched_at ON matches (matched_at DESC);

-- The two fastest-growing append-only tables. BRIN is a few kB where a btree
-- would be tens of MB, and a day-bucketed range aggregate is all it must serve.
CREATE INDEX IF NOT EXISTS idx_messages_created_brin ON messages USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_swipes_created_brin   ON swipes   USING BRIN (created_at);

-- The funnel asks "has this user ever sent a message". The only existing index
-- on sender_id is partial (WHERE client_msg_id IS NOT NULL, 022) and cannot
-- answer it, so that step would seq-scan messages.
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);

-- Moderation: every report about one target, and everything one user reported.
CREATE INDEX IF NOT EXISTS idx_reports_target   ON reports (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brand_verification_queue
  ON brand_profiles (verification_submitted_at) WHERE verification_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_brand_ratings_influencer ON brand_ratings (influencer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_id   ON posts   (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories (created_at DESC);

-- ── 6. Broadcasts need a notification type ────────────────────────
-- 025 declared this CHECK inline, so Postgres named it <table>_<column>_check.
-- Without widening it an announcement insert fails with a 23514.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('new_match', 'new_like', 'new_message', 'announcement'));

CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  data            JSONB   NOT NULL DEFAULT '{}'::jsonb,
  segment         JSONB   NOT NULL DEFAULT '{}'::jsonb,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  -- A retried POST must not push the same announcement to everyone twice.
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created
  ON admin_broadcasts (created_at DESC);

-- ── 7. Typed settings ─────────────────────────────────────────────
ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS updated_by  TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE admin_settings ALTER COLUMN updated_at SET DEFAULT now();

INSERT INTO admin_settings (key, value, description) VALUES
  ('feature_flags',
   '{}'::jsonb,
   'Boolean switches read by the API and shipped to the app'),
  ('maintenance_mode',
   '{"enabled":false,"message":"Matchr is down for maintenance. Back shortly.","allow_admins":true}'::jsonb,
   'When enabled, non-admin API traffic gets a 503')
ON CONFLICT (key) DO NOTHING;

-- ── 8. Daily metrics rollup ───────────────────────────────────────
-- Left empty on purpose: backfilling inside the migration transaction would
-- scan every table on the deploy that ships it. services/adminMetrics.js
-- backfills in bounded day batches on first run.
CREATE TABLE IF NOT EXISTS admin_metrics_daily (
  day                DATE PRIMARY KEY,
  signups            INTEGER NOT NULL DEFAULT 0,
  brand_signups      INTEGER NOT NULL DEFAULT 0,
  influencer_signups INTEGER NOT NULL DEFAULT 0,
  swipes             INTEGER NOT NULL DEFAULT 0,
  likes              INTEGER NOT NULL DEFAULT 0,
  matches            INTEGER NOT NULL DEFAULT 0,
  messages           INTEGER NOT NULL DEFAULT 0,
  active_senders     INTEGER NOT NULL DEFAULT 0,
  reports            INTEGER NOT NULL DEFAULT 0,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_metrics_daily IS
  'Day buckets in METRICS_TZ (default Asia/Kolkata). Today is always recomputed live.';
