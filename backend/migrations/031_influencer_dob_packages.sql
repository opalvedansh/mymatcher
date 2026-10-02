-- Migration 031: two things onboarding asked creators for and then threw away.
--
-- 1. Date of birth. Stored so the age on a profile is worked out on read and
--    never goes stale; the date itself is private, only the age is shown.
-- 2. Price packages. The profile used to show the same four hardcoded prices
--    for every creator. Each entry is { type, price } with price in whole INR.
ALTER TABLE influencer_profiles
  ADD COLUMN IF NOT EXISTS dob      DATE,
  ADD COLUMN IF NOT EXISTS packages JSONB NOT NULL DEFAULT '[]'::jsonb;
