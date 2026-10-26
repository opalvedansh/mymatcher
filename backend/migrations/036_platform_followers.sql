-- Migration 036: Follower counts per active platform, for creators and brands.
--
-- platform_handles maps a platform id from `platforms` to the account the
-- user gave for it, normalized (a username, channel id or invite code). The
-- server fetches follower counts for these accounts.
--
-- platform_followers maps a platform id to
-- { "count": 12000, "source": "self" | "synced", "updated_at": "<ISO time>",
--   "handle": "<the handle it was fetched for>" (synced only) }.
-- "self" counts are typed by the user; "synced" ones are fetched by the server
-- and take precedence, so typing can never replace a fetched number. A
-- creator's Instagram count stays in influencer_profiles.followers (the
-- Instagram sync owns it) and is merged in when a profile is read.
ALTER TABLE influencer_profiles
  ADD COLUMN IF NOT EXISTS platform_followers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS platform_handles   JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS platform_followers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS platform_handles   JSONB NOT NULL DEFAULT '{}'::jsonb;
