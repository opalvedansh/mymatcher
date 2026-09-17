-- Migration 023: Companies an influencer has worked with (shown on their profile)
ALTER TABLE influencer_profiles
  ADD COLUMN IF NOT EXISTS worked_with TEXT[] DEFAULT '{}';
