-- Migration 027: the three brand-profile sections that had no data behind them.
--
-- 1. Payment terms the brand states itself (Matchr neither holds nor
--    guarantees payment, so the profile labels these as the brand's claim).
-- 2. Ratings left by creators the brand actually matched with.
-- 3. Business verification the brand requests and an admin approves.

BEGIN;

-- ── 1. Payment terms ──────────────────────────────────────────────
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS payment_mode TEXT,
  ADD COLUMN IF NOT EXISTS payment_days SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS brand_payment_mode_known;
ALTER TABLE brand_profiles
  ADD CONSTRAINT brand_payment_mode_known CHECK (
    payment_mode IS NULL OR payment_mode IN ('bank_transfer', 'upi', 'cheque', 'paypal')
  );

ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS brand_payment_days_range;
ALTER TABLE brand_profiles
  ADD CONSTRAINT brand_payment_days_range CHECK (payment_days BETWEEN 0 AND 90);

-- ── 2. Creator ratings of a brand ─────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_ratings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  influencer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kept for provenance; the rating survives an archived or deleted match.
  match_id      UUID REFERENCES matches(id) ON DELETE SET NULL,
  score         SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One rating per creator per brand; rating again updates it.
  CONSTRAINT brand_ratings_one_per_pair UNIQUE (brand_id, influencer_id)
);

CREATE INDEX IF NOT EXISTS idx_brand_ratings_brand ON brand_ratings(brand_id);

-- ── 3. Business verification ──────────────────────────────────────
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verification_business_name TEXT,
  ADD COLUMN IF NOT EXISTS verification_reg_number TEXT,
  ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_note TEXT;

ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS brand_verification_status_known;
ALTER TABLE brand_profiles
  ADD CONSTRAINT brand_verification_status_known CHECK (
    verification_status IN ('none', 'pending', 'approved', 'rejected')
  );

-- Brands verified before this migration keep their badge.
UPDATE brand_profiles SET verification_status = 'approved'
  WHERE verified = true AND verification_status = 'none';

COMMIT;
