-- Migration 024: LinkedIn recommendations an influencer shows on their profile.
-- Self-reported: each entry links back to LinkedIn so viewers can check it.
-- Entry shape: { id, quote, reviewer_name, reviewer_title, linkedin_url, added_at }
ALTER TABLE influencer_profiles
  ADD COLUMN IF NOT EXISTS linkedin_reviews JSONB DEFAULT '[]'::jsonb;
