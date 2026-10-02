-- Migration 033: reviews of a creator are plain reviews, not LinkedIn ones.
--
-- Migration 032 required each review to carry a LinkedIn link. Reviews are
-- now just the matched brand's words, so the link goes. No review had been
-- written when this ran, so nothing is lost.
ALTER TABLE creator_reviews DROP COLUMN IF EXISTS linkedin_url;
