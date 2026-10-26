const UPLOAD_BUCKET = 'public';

function publicUploadPrefix(userId) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${UPLOAD_BUCKET}/uploads/${userId}/`;
}

/**
 * True only for a file this user uploaded through /api/upload. Anything else —
 * data: URIs, third-party hosts, other users' files — is rejected, so stored
 * media can't be used for tracking pixels, phishing links or DB bloat.
 */
// One file directly in the user's folder: uploads are "<uuid>.<ext>", reel
// thumbnails "reel-<shortcode>.<ext>". URL parsing resolves literal `..`, but
// not a percent-encoded "/" ("..%2Fother-user%2Fx.jpg"), which storage decodes;
// only allowing a plain file name closes that.
const OWN_FILE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

function isOwnUploadUrl(url, userId) {
  if (typeof url !== 'string' || !process.env.SUPABASE_URL) return false;
  let normalized;
  try {
    normalized = new URL(url).href;
  } catch {
    return false;
  }
  const prefix = publicUploadPrefix(userId);
  return normalized.startsWith(prefix)
    && OWN_FILE_NAME.test(normalized.slice(prefix.length).split(/[?#]/)[0]);
}

/**
 * The storage key ("uploads/<uid>/<file>") behind a public upload URL — the
 * inverse of publicUploadPrefix, for deleting the object when moderation
 * removes the row that referenced it. Returns null for anything this user did
 * not upload, so it can never be pointed at another user's folder.
 */
function storagePathFromUrl(url, userId) {
  if (!isOwnUploadUrl(url, userId)) return null;
  const prefix = publicUploadPrefix(userId);
  const rest = new URL(url).href.slice(prefix.length).split('?')[0];
  return rest ? `uploads/${userId}/${decodeURIComponent(rest)}` : null;
}

module.exports = { UPLOAD_BUCKET, publicUploadPrefix, isOwnUploadUrl, storagePathFromUrl };
