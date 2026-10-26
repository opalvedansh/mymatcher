const logger = require('../config/logger');
const { getClient, runActor } = require('./apifyClient');

// Actor IDs — using the well-known Apify community actors
const PROFILE_ACTOR_ID = 'apify/instagram-profile-scraper';

/**
 * Scrape several Instagram profiles in one actor run (one run is billed, not
 * one per profile).
 *
 * @param {string[]} handles - Instagram usernames (without @)
 * @returns {Promise<Map<string, ReturnType<typeof normalizeProfile>>>} stats keyed
 *   by lowercased username; private, renamed or missing handles are absent
 * @throws when the actor run itself fails
 */
async function scrapeInstagramProfiles(handles) {
  logger.info({ count: handles.length }, 'Starting Apify Instagram profile scrape');

  // Scales with the batch: one profile takes well under a minute.
  const items = await runActor(PROFILE_ACTOR_ID, { usernames: handles }, {
    timeoutSecs: Math.min(120 + handles.length * 10, 900),
  });

  const byHandle = new Map();
  for (const profile of items) {
    if (profile.username) byHandle.set(profile.username.toLowerCase(), normalizeProfile(profile));
  }
  logger.info({ requested: handles.length, returned: byHandle.size }, 'Apify scrape completed');
  return byHandle;
}

/**
 * Scrape an Instagram profile and return normalized stats.
 *
 * @param {string} handle - Instagram username (without @)
 * @returns {Promise<{followers: number, engagement_rate: number, avg_views: number, bio: string, avatar_url: string} | null>}
 */
async function syncInstagramProfile(handle) {
  try {
    const byHandle = await scrapeInstagramProfiles([handle]);
    const stats = byHandle.get(handle.toLowerCase());
    if (!stats) {
      logger.warn({ handle }, 'Apify returned no data for Instagram handle');
      return null;
    }
    return stats;
  } catch (err) {
    logger.error({ handle, error: err.message, stack: err.stack }, 'Apify Instagram scrape failed');
    return null;
  }
}

/** Turns one scraped profile into the stats stored on influencer_profiles. */
function normalizeProfile(profile) {
  // ── Compute engagement rate ──────────────────────────────────
  // engagement_rate = (avg likes + avg comments) / followers * 100
  let engagementRate = 0;
  if (profile.followersCount > 0) {
    const avgLikes = profile.avgLikes || profile.averageLikes || 0;
    const avgComments = profile.avgComments || profile.averageComments || 0;
    engagementRate = parseFloat(
      (((avgLikes + avgComments) / profile.followersCount) * 100).toFixed(2)
    );
  }

  // ── Compute average reel/video views ─────────────────────────
  // Some actors return latestPosts with video view counts
  let avgViews = 0;
  if (profile.latestPosts && profile.latestPosts.length > 0) {
    const videoPosts = profile.latestPosts.filter(
      (p) => p.videoViewCount != null && p.videoViewCount > 0
    );
    if (videoPosts.length > 0) {
      const totalViews = videoPosts.reduce((sum, p) => sum + p.videoViewCount, 0);
      avgViews = Math.round(totalViews / videoPosts.length);
    }
  }

  // ── Extract Reels/Top Videos ─────────────────────────────────
  let reels = [];
  if (profile.latestPosts && profile.latestPosts.length > 0) {
    const videoPosts = profile.latestPosts.filter(
      (p) => p.videoViewCount != null && p.videoViewCount > 0
    );
    // Grab top 3 recent videos
    reels = videoPosts.slice(0, 3).map(p => ({
      id: p.shortCode || String(p.id),
      url: p.url || (p.shortCode ? `https://www.instagram.com/reel/${p.shortCode}/` : ''),
      thumbnail_url: p.displayUrl || p.thumbnailUrl || '',
      views: String(p.videoViewCount)
    }));
  }

  return {
    followers: profile.followersCount || 0,
    engagement_rate: engagementRate,
    avg_views: avgViews,
    bio: profile.biography || null,
    avatar_url: profile.profilePicUrlHD || profile.profilePicUrl || null,
    reels,
  };
}

/**
 * Search Instagram profiles using Apify's instagram-search-scraper
 *
 * @param {string} query - The search string
 * @returns {Promise<string[]>} Array of usernames
 */
async function searchInstagramProfiles(query) {
  const apify = getClient();
  logger.info({ query }, 'Starting Apify Instagram search scrape');

  try {
    const run = await apify.actor('apify/instagram-search-scraper').call(
      {
        search: query,
        searchType: "user",
        resultsType: "details", // need details or it might not return items nicely
        searchLimit: 6
      },
      {
        timeout: 60,          
        memory: 256,
        waitSecs: 60,         
      }
    );

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();

    if (!items || items.length === 0) {
      return [];
    }
    
    return items.map(item => item.username).filter(Boolean);
  } catch (err) {
    logger.error({ query, error: err.message }, 'Apify Instagram search failed');
    return [];
  }
}

module.exports = { syncInstagramProfile, scrapeInstagramProfiles, searchInstagramProfiles };
