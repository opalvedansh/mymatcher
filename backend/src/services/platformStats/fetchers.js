// One follower-count fetcher per platform. Each takes canonical handles (see
// handles.js) and resolves to a Map of handle → follower count. Handles it
// could not read (private, deleted, renamed) are left out of the Map; a
// failed scraper run rejects, so the caller can tell "no data" from "broken".
//
// Most platforms go through Apify actors, billed per profile. Discord,
// Snapchat, Behance and Dribbble publish the count on a public page or API,
// so they are read directly at no cost.

const logger = require('../../config/logger');
const { runActor } = require('../apifyClient');
const { scrapeInstagramProfiles } = require('../instagramSyncService');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** 12,345 / "1.2M" / "12K" / 12345 → 12345. Null when it isn't a count. */
function parseCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const m = value.trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KkMmBb])?$/);
  if (!m) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * scale);
}

/**
 * A fetcher backed by an Apify actor. `identity(item)` names the account an
 * output item belongs to, so a batch can be matched back to its handles.
 */
function apifyFetcher({ actor, batchSize = 25, input, identity, count, accept = () => true, timeoutSecs }) {
  return {
    batchSize,
    async fetch(handles) {
      const items = await runActor(actor, input(handles), {
        timeoutSecs: timeoutSecs || Math.min(120 + handles.length * 15, 900),
      });
      const wanted = new Map(handles.map((h) => [h.toLowerCase(), h]));
      const counts = new Map();
      for (const item of items) {
        if (!accept(item)) continue;
        const value = parseCount(count(item));
        if (value == null) continue;
        const id = identity(item);
        const handle = id != null ? wanted.get(String(id).toLowerCase()) : undefined;
        // A one-handle run has nothing to mix up; batches need a match.
        const target = handle ?? (handles.length === 1 ? handles[0] : undefined);
        if (target && !counts.has(target)) counts.set(target, value);
      }
      return counts;
    },
  };
}

/** A fetcher that reads one public page or API per handle. */
function directFetcher(readOne) {
  return {
    batchSize: 25,
    async fetch(handles) {
      const counts = new Map();
      let failures = 0;
      for (const handle of handles) {
        try {
          const value = await readOne(handle);
          if (value != null) counts.set(handle, value);
        } catch (err) {
          failures++;
          logger.warn({ handle, err: err.message }, '[PlatformStats] direct read failed');
        }
      }
      // Every read failing means the source is blocking us, not that every
      // account vanished.
      if (handles.length && failures === handles.length) throw new Error('every direct read failed');
      return counts;
    },
  };
}

/** GETs a page; null on 404 (the account doesn't exist), throws otherwise. */
async function getPage(url, { json = false } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: json ? 'application/json' : 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return json ? res.json() : res.text();
}

const youtubeUrl = (handle) => `https://www.youtube.com/${handle}`;
const linkedinSlug = (handle) => handle.split('/')[1];

const linkedinPeople = apifyFetcher({
  actor: 'harvestapi/linkedin-profile-scraper',
  input: (handles) => ({
    publicIdentifiers: handles.map(linkedinSlug),
    profileScraperMode: 'Profile details no email ($4 per 1k)',
  }),
  identity: (item) => item.publicIdentifier && `in/${item.publicIdentifier}`,
  count: (item) => item.followerCount,
});

const linkedinCompanies = apifyFetcher({
  actor: 'harvestapi/linkedin-company',
  input: (handles) => ({ companies: handles.map((h) => `https://www.linkedin.com/${h}`) }),
  identity: (item) => item.universalName && `company/${item.universalName}`,
  count: (item) => item.followerCount,
});

const FETCHERS = {
  instagram: {
    batchSize: 25,
    async fetch(handles) {
      const byHandle = await scrapeInstagramProfiles(handles);
      return new Map(handles.filter((h) => byHandle.has(h)).map((h) => [h, byHandle.get(h).followers]));
    },
  },

  tiktok: apifyFetcher({
    actor: 'clockworks/tiktok-profile-scraper',
    // Profile stats ride along on each video, so one video per profile is enough.
    input: (handles) => ({
      profiles: handles,
      resultsPerPage: 1,
      profileScrapeSections: ['videos'],
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
    }),
    identity: (item) => item.authorMeta?.name,
    count: (item) => item.authorMeta?.fans,
  }),

  youtube: apifyFetcher({
    actor: 'streamers/youtube-channel-scraper',
    // Items don't reliably say which input URL they came from, so one
    // channel per run.
    batchSize: 1,
    input: (handles) => ({
      startUrls: handles.map((h) => ({ url: youtubeUrl(h) })),
      maxResults: 1,
      maxResultsShorts: 0,
      maxResultStreams: 0,
    }),
    identity: (item) => item.channelUsername && `@${String(item.channelUsername).replace(/^@/, '')}`,
    count: (item) => item.numberOfSubscribers,
  }),

  x: apifyFetcher({
    actor: 'apidojo/twitter-user-scraper',
    input: (handles) => ({
      twitterHandles: handles,
      getFollowers: false,
      getFollowing: false,
      getRetweeters: false,
      maxItems: handles.length,
    }),
    identity: (item) => item.userName,
    count: (item) => item.followers,
    accept: (item) => item.type === undefined || item.type === 'user',
  }),

  facebook: apifyFetcher({
    actor: 'apify/facebook-pages-scraper',
    batchSize: 1, // matched by position, see youtube
    input: (handles) => ({ startUrls: handles.map((h) => ({ url: `https://www.facebook.com/${h}` })) }),
    identity: (item) => item.pageName,
    count: (item) => item.followers ?? item.likes,
  }),

  threads: apifyFetcher({
    actor: 'apify/threads-profile-api-scraper',
    input: (handles) => ({ usernames: handles }),
    identity: (item) => item.username,
    count: (item) => item.follower_count,
  }),

  linkedin: {
    batchSize: 25,
    async fetch(handles) {
      const people = handles.filter((h) => h.startsWith('in/'));
      const companies = handles.filter((h) => h.startsWith('company/'));
      const [a, b] = await Promise.all([
        people.length ? linkedinPeople.fetch(people) : new Map(),
        companies.length ? linkedinCompanies.fetch(companies) : new Map(),
      ]);
      return new Map([...a, ...b]);
    },
  },

  pinterest: apifyFetcher({
    actor: 'easyapi/pinterest-profile-scraper',
    input: (handles) => ({ usernames: handles }),
    identity: (item) => item.username,
    count: (item) => item.follower_count,
  }),

  reddit: apifyFetcher({
    actor: 'harshmaur/reddit-user-scraper',
    input: (handles) => ({ usernames: handles.map((h) => `u/${h}`) }),
    identity: (item) => item.username,
    count: (item) => item.followersCount,
    accept: (item) => !item.dataType || item.dataType === 'user_profile',
  }),

  twitch: apifyFetcher({
    actor: 'piotrv1001/twitch-channel-scraper',
    input: (handles) => ({ channels: handles, videosPerChannel: 0, clipsPerChannel: 0 }),
    identity: (item) => item.login,
    count: (item) => item.followers,
    accept: (item) => !item.type || item.type === 'channel',
  }),

  spotify: apifyFetcher({
    actor: 'khadinakbar/spotify-artist-scraper',
    input: (handles) => ({
      artists: handles.map((id) => `https://open.spotify.com/artist/${id}`),
      responseFormat: 'concise',
    }),
    identity: (item) => item.id,
    count: (item) => item.followers,
    accept: (item) => !item.type || item.type === 'artist',
  }),

  discord: directFetcher(async (code) => {
    const data = await getPage(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`, { json: true });
    return data ? parseCount(data.approximate_member_count) : null;
  }),

  snapchat: directFetcher(async (name) => {
    const html = await getPage(`https://www.snapchat.com/add/${encodeURIComponent(name)}`);
    const data = html && html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!data) return null;
    const info = JSON.parse(data[1])?.props?.pageProps?.userProfile?.publicProfileInfo;
    // Only public profiles show subscribers; a personal account has none.
    if (!info || String(info.username).toLowerCase() !== name) return null;
    return parseCount(info.subscriberCount);
  }),

  behance: directFetcher(async (name) => {
    const html = await getPage(`https://www.behance.net/${encodeURIComponent(name)}`);
    const data = html && html.match(/<script[^>]+id="beconfig-store_state"[^>]*>([\s\S]*?)<\/script>/);
    if (!data) return null;
    const user = JSON.parse(data[1])?.profile?.user;
    if (!user || String(user.username).toLowerCase() !== name) return null;
    return parseCount(user.stats?.followers);
  }),

  dribbble: directFetcher(async (name) => {
    const html = await getPage(`https://dribbble.com/${encodeURIComponent(name)}/about`);
    const m = html && html.match(/([\d,.]+[kKmM]?)\s*<\/span>\s*<span[^>]*>\s*followers/i);
    return m ? parseCount(m[1]) : null;
  }),
};
FETCHERS.twitter = FETCHERS.x;

module.exports = { FETCHERS, parseCount };
