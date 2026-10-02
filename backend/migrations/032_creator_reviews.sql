-- Migration 032: LinkedIn reviews of a creator, written by brands they matched with.
--
-- Until now a creator typed their own LinkedIn reviews into
-- influencer_profiles.linkedin_reviews (migration 024). Now only a brand that
-- actually matched with the creator can add one, linked to LinkedIn so other
-- brands can check who wrote it. That old column stays so app builds from
-- before this change keep saving, but nothing shows it any more.

BEGIN;

CREATE TABLE IF NOT EXISTS creator_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kept for provenance; the review survives an archived or deleted match.
  match_id       UUID REFERENCES matches(id) ON DELETE SET NULL,
  quote          TEXT NOT NULL CHECK (char_length(quote) BETWEEN 10 AND 600),
  reviewer_name  TEXT NOT NULL CHECK (char_length(reviewer_name) BETWEEN 1 AND 80),
  reviewer_title TEXT CHECK (char_length(reviewer_title) <= 100),
  linkedin_url   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One review per brand per creator; reviewing again edits it.
  CONSTRAINT creator_reviews_one_per_pair UNIQUE (influencer_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_reviews_influencer
  ON creator_reviews(influencer_id, created_at DESC);

-- Reviews are text other users read, so they can be reported (Guideline 1.2).
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'post', 'story', 'message', 'review'));

COMMIT;
