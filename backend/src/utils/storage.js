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
function isOwnUploadUrl(url, userId) {
  if (typeof url !== 'string' || !process.env.SUPABASE_URL) return false;
  let normalized;
  try {
    // URL parsing resolves `..` segments, so a path can't escape the prefix.
    normalized = new URL(url).href;
  } catch {
    return false;
  }
  return normalized.startsWith(publicUploadPrefix(userId));
}

module.exports = { UPLOAD_BUCKET, publicUploadPrefix, isOwnUploadUrl };
