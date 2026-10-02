// LinkedIn links on reviews: https only, and only linkedin.com or its lnkd.in
// short links, so a "View on LinkedIn" button can't send anyone elsewhere.
const LINKEDIN_HOST = /(^|\.)(linkedin\.com|lnkd\.in)$/i;

/** The link normalised by URL parsing, or null if it isn't an https LinkedIn link. */
function parseLinkedinUrl(raw) {
  let url;
  try {
    url = new URL(typeof raw === 'string' ? raw.trim() : '');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !LINKEDIN_HOST.test(url.hostname)) return null;
  return url.toString();
}

module.exports = { parseLinkedinUrl };
