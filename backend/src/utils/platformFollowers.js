// Follower counts and accounts per platform (see migration 036 for the stored shape).

const { normalizeHandle } = require('../services/platformStats/handles');

const MAX_PLATFORMS = 20;
const MAX_COUNT = 2000000000; // past the largest account on any platform
const PLATFORM_ID = /^[a-z0-9_-]{1,30}$/;

/**
 * Applies the counts a user typed on top of what is stored.
 *
 * `input` is the full replacement list of typed counts, { platform: count };
 * a platform left out loses its typed count. Fetched ("synced") entries are
 * kept as they are and typed counts for those platforms are ignored, so only
 * the server's fetchers ever change them.
 *
 * @param {unknown} input
 * @param {Record<string, {count: number, source: string, updated_at: string}>} stored
 * @param {string[]} [ignore] platforms whose count lives elsewhere (a creator's
 *   synced Instagram), dropped from the input
 * @returns the new map to store
 * @throws an error with status 400 describing the first problem
 */
function cleanPlatformFollowers(input, stored = {}, ignore = []) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('platform_followers must map each platform to a follower count');
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_PLATFORMS) throw fail(`Add follower counts for up to ${MAX_PLATFORMS} platforms`);

  const next = {};
  for (const [platform, entry] of Object.entries(stored || {})) {
    if (entry?.source === 'synced') next[platform] = entry;
  }

  const now = new Date().toISOString();
  for (const [rawPlatform, count] of entries) {
    const platform = rawPlatform.trim().toLowerCase();
    if (!PLATFORM_ID.test(platform)) throw fail('Each platform needs a short id like "youtube"');
    if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
      throw fail('Each follower count must be a whole number of 0 or more');
    }
    if (next[platform] || ignore.includes(platform)) continue;
    const previous = stored?.[platform];
    // An unchanged count keeps its date, so updated_at says when it last moved.
    next[platform] = {
      count,
      source: 'self',
      updated_at: previous?.count === count && previous.updated_at ? previous.updated_at : now,
    };
  }
  return next;
}

const PLATFORM_LABELS = {
  instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', twitter: 'Twitter',
  reddit: 'Reddit', pinterest: 'Pinterest', facebook: 'Facebook', linkedin: 'LinkedIn',
  snapchat: 'Snapchat', threads: 'Threads', spotify: 'Spotify', twitch: 'Twitch',
  discord: 'Discord', behance: 'Behance', dribbble: 'Dribbble',
};

/**
 * Validates the full replacement list of account handles, { platform: text }.
 * Each is normalized to the form the fetchers use; an empty value removes it.
 * A creator's Instagram is left out: the Instagram sync owns instagram_handle.
 *
 * @returns {Record<string, string>} the handles to store
 * @throws an error with status 400 naming the first account that isn't valid
 */
function cleanPlatformHandles(input, role) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('platform_handles must map each platform to an account');
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_PLATFORMS) throw fail(`Add accounts for up to ${MAX_PLATFORMS} platforms`);

  const handles = {};
  for (const [rawPlatform, raw] of entries) {
    const platform = rawPlatform.trim().toLowerCase();
    if (!PLATFORM_ID.test(platform)) throw fail('Each platform needs a short id like "youtube"');
    if (role === 'influencer' && platform === 'instagram') continue;
    if (raw === null || (typeof raw === 'string' && !raw.trim())) continue;
    const handle = normalizeHandle(platform, raw, role);
    if (!handle) {
      const label = PLATFORM_LABELS[platform] || platform;
      throw fail(`That doesn't look like a ${label} account. Paste your profile link or username.`);
    }
    handles[platform] = handle;
  }
  return handles;
}

/** Drops fetched counts that belong to a handle the profile no longer lists. */
function dropStaleSynced(followers, handles) {
  const next = {};
  for (const [platform, entry] of Object.entries(followers || {})) {
    if (entry?.source === 'synced' && entry.handle !== handles?.[platform]) continue;
    next[platform] = entry;
  }
  return next;
}

/**
 * The map a profile is returned with: a creator's synced Instagram count
 * (influencer_profiles.followers) shown as Instagram's entry.
 */
function withSyncedInstagram(platformFollowers, followers, syncedAt) {
  const map = { ...(platformFollowers || {}) };
  if (followers > 0 && syncedAt) {
    map.instagram = { count: followers, source: 'synced', updated_at: new Date(syncedAt).toISOString() };
  }
  return map;
}

module.exports = { cleanPlatformFollowers, cleanPlatformHandles, dropStaleSynced, withSyncedInstagram };
