-- Migration 026: What a brand asks for in a collaboration.
--
-- The profile used to show a fixed "1 Reel, 2 Stories, 1 Post" for every
-- brand. These columns hold what the brand actually asks for; 0 means the
-- brand has not said, and the profile shows nothing for that line.
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS deliverable_reels   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deliverable_stories SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deliverable_posts   SMALLINT NOT NULL DEFAULT 0;

-- A campaign asking for more than 99 of anything is a typo, not a campaign.
ALTER TABLE brand_profiles
  DROP CONSTRAINT IF EXISTS brand_deliverables_range;
ALTER TABLE brand_profiles
  ADD CONSTRAINT brand_deliverables_range CHECK (
    deliverable_reels   BETWEEN 0 AND 99 AND
    deliverable_stories BETWEEN 0 AND 99 AND
    deliverable_posts   BETWEEN 0 AND 99
  );
