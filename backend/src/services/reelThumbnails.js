const logger = require('../config/logger');
const { UPLOAD_BUCKET, publicUploadPrefix, isOwnUploadUrl } = require('../utils/storage');
const { getSupabaseAdmin } = require('../config/supabaseAdmin');

const MAX_REELS = 20;
const MAX_FETCHES_PER_SAVE = 3;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
// A reel's fetches (page, embed page, image) must fit the app's 15s request timeout.
const FETCH_TIMEOUT_MS = 4000;

// Instagram only serves Open Graph tags to link-preview crawlers; a browser
// user agent gets a JS shell with no og:image.
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const REEL_PATH = /^\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]{5,40})\/?$/;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Returns the post shortcode, or null if `url` isn't an Instagram post/reel link. */
function reelShortcode(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(parsed.hostname)) return null;
  return parsed.pathname.match(REEL_PATH)?.[1] ?? null;
}

// og:image must point at Instagram's CDN — we're about to fetch it server-side.
function isInstagramCdn(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname.endsWith('.cdninstagram.com') || hostname.endsWith('.fbcdn.net'));
  } catch {
    return false;
  }
}

function decodeHtmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"');
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': CRAWLER_UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return res.ok ? res.text() : null;
}

// Tries the post page's og:image, then the public embed page. Both are empty
// for removed, private or age-restricted posts.
async function findPreviewImage(shortcode) {
  const page = await fetchHtml(`https://www.instagram.com/reel/${shortcode}/`);
  const og = page?.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)
    || page?.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);
  if (og) return decodeHtmlEntities(og[1]);

  const embed = await fetchHtml(`https://www.instagram.com/reel/${shortcode}/embed/`);
  const img = embed?.match(/class="EmbeddedMediaImage"[^>]*\ssrc="([^"]+)"/);
  return img ? decodeHtmlEntities(img[1]) : null;
}

/**
 * Copies an Instagram CDN image into our bucket. Instagram CDN links are
 * signed and expire within days, so storing the remote URL isn't enough.
 */
async function storeThumbnail(imageUrl, userId, shortcode) {
  if (!isInstagramCdn(imageUrl)) return null;
  const res = await fetch(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return null;
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length === 0 || body.length > MAX_THUMBNAIL_BYTES) return null;

  const objectName = `reel-${shortcode}.${ext}`;
  const { error } = await getSupabaseAdmin()
    .storage
    .from(UPLOAD_BUCKET)
    .upload(`uploads/${userId}/${objectName}`, body, { contentType, upsert: true });
  if (error) throw error;
  return publicUploadPrefix(userId) + objectName;
}

/** Best effort: returns a stored thumbnail URL, or null. Never throws. */
async function fetchReelThumbnail(url, userId, knownImageUrl) {
  const shortcode = reelShortcode(url);
  if (!shortcode) return null;
  try {
    let stored = knownImageUrl ? await storeThumbnail(knownImageUrl, userId, shortcode) : null;
    if (!stored) {
      const preview = await findPreviewImage(shortcode);
      if (preview) stored = await storeThumbnail(preview, userId, shortcode);
    }
    return stored;
  } catch (err) {
    logger.warn({ userId, shortcode, err: err.message }, 'Reel thumbnail fetch failed');
    return null;
  }
}

/**
 * Validates a client-submitted reels list and attaches thumbnails.
 *
 * Only `url` is taken from the client. Views and thumbnails come from the
 * reel already saved with that URL (written by us), or are fetched fresh, so
 * a user can't inflate view counts or point a thumbnail at an arbitrary host.
 *
 * @throws {Error & {status: number}} on invalid input
 */
async function prepareReels(submitted, previous, userId) {
  if (!Array.isArray(submitted) || submitted.length > MAX_REELS) {
    throw Object.assign(new Error(`reels must be a list of at most ${MAX_REELS} items`), { status: 400 });
  }
  const previousByUrl = new Map((previous || []).map((r) => [r.url, r]));

  const urls = submitted.map((item) => {
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    if (!reelShortcode(url)) {
      throw Object.assign(new Error('Each reel must be an Instagram reel link'), { status: 400 });
    }
    return url;
  });

  // Each fetch is two slow requests to Instagram; bound the work per save.
  let fetchBudget = MAX_FETCHES_PER_SAVE;

  return Promise.all(submitted.map(async (item, i) => {
    const url = urls[i];
    const prior = previousByUrl.get(url);
    const id = prior?.id ?? (typeof item.id === 'string' && item.id.length <= 64 ? item.id : reelShortcode(url));

    let thumbnailUrl = prior?.thumbnail_url && isOwnUploadUrl(prior.thumbnail_url, userId)
      ? prior.thumbnail_url
      : null;
    if (!thumbnailUrl && fetchBudget > 0) {
      fetchBudget--;
      thumbnailUrl = await fetchReelThumbnail(url, userId, prior?.thumbnail_url);
    }
    // A CDN link saved by an earlier sync still works until it expires.
    if (!thumbnailUrl && prior?.thumbnail_url && isInstagramCdn(prior.thumbnail_url)) {
      thumbnailUrl = prior.thumbnail_url;
    }

    return {
      id,
      url,
      views: prior?.views ?? '0',
      ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    };
  }));
}

/** Replaces the expiring CDN thumbnails from an Instagram sync with stored copies. */
async function persistSyncedThumbnails(reels, userId) {
  return Promise.all(reels.map(async (reel) => {
    const stored = await fetchReelThumbnail(reel.url, userId, reel.thumbnail_url);
    return stored ? { ...reel, thumbnail_url: stored } : reel;
  }));
}

module.exports = { reelShortcode, prepareReels, persistSyncedThumbnails };
