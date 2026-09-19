const db = require('../config/db');

/**
 * Public share pages for posts.
 *
 * Nothing here is authenticated: these URLs are meant to be pasted into
 * WhatsApp, iMessage and Instagram DMs, where the recipient may not have the
 * app at all. That shapes the rules below.
 *
 * On a device with the app installed, iOS Universal Links / Android App Links
 * intercept the URL and the app opens without this page ever rendering. This
 * page is what everyone else sees: an OpenGraph preview for the link unfurler,
 * and a real page with the post on it for a human who taps through.
 */

// The origin the links are built from. Must match the domain in the
// association files, or App Links silently stop matching.
const PUBLIC_WEB_URL = (process.env.PUBLIC_WEB_URL || 'https://api.mymatchr.in').replace(/\/$/, '');
const APP_SCHEME = process.env.APP_SCHEME || 'matchr';
const IOS_APP_STORE_URL = process.env.IOS_APP_STORE_URL || '';
const ANDROID_PLAY_URL =
  process.env.ANDROID_PLAY_URL || 'https://play.google.com/store/apps/details?id=com.webnexis.matchr';

const shareUrlForPost = (postId) => `${PUBLIC_WEB_URL}/p/${postId}`;

// Every interpolated value below is post content or a profile name, so all of
// it is escaped. A caption is user input and reaches both HTML text and
// attribute positions.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * GET /p/:postId
 * Renders the share page, or a generic "post unavailable" page.
 */
async function sharePage(req, res) {
  const { postId } = req.params;

  // A malformed id is a 404 page, not a database error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
    return res.status(404).type('html').send(missingPage());
  }

  let post;
  try {
    const { rows } = await db.query(
      `SELECT
         p.id, p.image_url, p.caption, p.likes_count, p.comments_count,
         COALESCE(ip.name, bp.name) AS author_name,
         COALESCE(ip.avatar_url, bp.logo_url) AS author_avatar
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
       LEFT JOIN brand_profiles bp ON bp.user_id = p.user_id
       WHERE p.id = $1
         AND u.banned = false
         AND u.deleted_at IS NULL`,
      [postId]
    );
    post = rows[0];
  } catch (err) {
    req.log?.error?.({ err, postId }, '[share] lookup failed');
    return res.status(500).type('html').send(missingPage());
  }

  if (!post) return res.status(404).type('html').send(missingPage());

  // Which store to offer. The page cannot know whether the app is installed
  // (if it were, App Links would have opened it and this never renders), but
  // it does know the platform, and offering an iPhone the Play Store is noise.
  const ua = String(req.headers['user-agent'] || '');
  const platform = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other';

  // A shared link is public, but it is not an archive: it stops working the
  // moment the post or the account goes away, and it is never indexed.
  res.set('X-Robots-Tag', 'noindex');
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(renderPost(post, platform));
}

function renderPost(post, platform) {
  const author = post.author_name || 'Someone';
  const caption = post.caption || '';
  const title = `${author} on Matchr`;
  const description = caption || 'See this post on Matchr.';
  const url = shareUrlForPost(post.id);
  const deepLink = `${APP_SCHEME}://p/${post.id}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Matchr">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(post.image_url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(post.image_url)}">

<style>
  :root {
    color-scheme: dark;
    --bg: #0b0b0f;
    --surface: #16161d;
    --border: #26262f;
    --text: #f4f4f6;
    --muted: #9b9ba6;
    --accent: #ff6b2b;
    --on-accent: #1a1a1a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex;
    justify-content: center;
    padding: 24px 16px 48px;
  }
  .card { width: 100%; max-width: 460px; }
  .author { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .avatar {
    width: 44px; height: 44px; border-radius: 50%;
    object-fit: cover; background: var(--surface);
  }
  .name { font-weight: 600; }
  .brand { color: var(--muted); font-size: 13px; }
  .photo {
    width: 100%; border-radius: 16px; display: block;
    border: 1px solid var(--border); background: var(--surface);
  }
  .caption { margin: 16px 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .stats { color: var(--muted); font-size: 14px; margin-bottom: 28px; }
  .cta {
    display: block; text-align: center; text-decoration: none;
    padding: 15px 20px; border-radius: 12px; font-weight: 600;
    background: var(--accent); color: var(--on-accent);
  }
  .cta.secondary {
    background: transparent; color: var(--text);
    border: 1px solid var(--border); margin-top: 10px;
  }
</style>
</head>
<body>
  <main class="card">
    <div class="author">
      ${post.author_avatar
        ? `<img class="avatar" src="${esc(post.author_avatar)}" alt="">`
        : `<div class="avatar"></div>`}
      <div>
        <div class="name">${esc(author)}</div>
        <div class="brand">on Matchr</div>
      </div>
    </div>

    <img class="photo" src="${esc(post.image_url)}" alt="${esc(caption || 'Post image')}">

    ${caption ? `<p class="caption">${esc(caption)}</p>` : ''}
    <div class="stats">${post.likes_count} likes · ${post.comments_count} comments</div>

    <a class="cta" href="${esc(deepLink)}">Open in Matchr</a>
    ${storeLink(platform)}
  </main>
</body>
</html>`;
}

// One store link, matching the device. An unknown platform gets nothing rather
// than a guess: a desktop browser cannot install either app.
function storeLink(platform) {
  if (platform === 'ios' && IOS_APP_STORE_URL) {
    return `<a class="cta secondary" href="${esc(IOS_APP_STORE_URL)}">Get Matchr for iPhone</a>`;
  }
  if (platform === 'android') {
    return `<a class="cta secondary" href="${esc(ANDROID_PLAY_URL)}">Get Matchr for Android</a>`;
  }
  return '';
}

function missingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Post unavailable · Matchr</title>
<meta name="robots" content="noindex">
<style>
  body {
    margin: 0; min-height: 100vh; display: grid; place-content: center;
    background: #0b0b0f; color: #f4f4f6; text-align: center; padding: 24px;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  p { color: #9b9ba6; }
</style>
</head>
<body>
  <div>
    <h1>Post unavailable</h1>
    <p>This post was removed, or the account no longer exists.</p>
  </div>
</body>
</html>`;
}

/**
 * GET /.well-known/apple-app-site-association
 *
 * iOS fetches this over HTTPS to decide which URLs open the app. It must be
 * served as application/json with no file extension and no redirect.
 * IOS_APP_ID_PREFIX is the Apple Team ID; without it the file would claim an
 * association that cannot be verified, so it 404s instead.
 */
function appleAppSiteAssociation(_req, res) {
  const teamId = process.env.IOS_APP_ID_PREFIX;
  const bundleId = process.env.IOS_BUNDLE_ID || 'com.webnexis.mymatcher1';
  if (!teamId) return res.status(404).json({ error: 'Not configured' });

  res.type('application/json').json({
    applinks: {
      details: [{ appIDs: [`${teamId}.${bundleId}`], components: [{ '/': '/p/*', comment: 'Shared posts' }] }],
    },
  });
}

/**
 * GET /.well-known/assetlinks.json
 *
 * The Android equivalent. ANDROID_CERT_SHA256 is the signing certificate
 * fingerprint of the *release* build (EAS: `eas credentials`). A wrong or
 * missing fingerprint means links open the browser instead of the app.
 */
function androidAssetLinks(_req, res) {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  const packageName = process.env.ANDROID_PACKAGE || 'com.webnexis.matchr';
  if (!fingerprints.length) return res.status(404).json({ error: 'Not configured' });

  res.type('application/json').json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}

module.exports = { sharePage, appleAppSiteAssociation, androidAssetLinks, shareUrlForPost };
