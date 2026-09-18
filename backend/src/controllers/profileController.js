const crypto = require('crypto');
const db = require('../config/db');
const { invalidateCache } = require('../middleware/cacheMiddleware');
const logger = require('../config/logger');
const { isOwnUploadUrl } = require('../utils/storage');
const sharedCache = require('../utils/sharedCache');
const feedDeck = require('../services/feedDeck');
const { prepareReels, persistSyncedThumbnails } = require('../services/reelThumbnails');

// ─── Helper: fetch full profile by userId + role (explicit columns) ──
async function fetchProfile(userId, role) {
  if (role === 'brand') {
    const { rows } = await db.query(
      `SELECT
         p.user_id, p.name, p.logo_url, p.cover_url, p.bio,
         p.categories, p.location, p.lat, p.lng,
         p.budget_min, p.budget_max, p.campaign_days,
         p.deliverable_reels, p.deliverable_stories, p.deliverable_posts,
         p.payment_mode, p.payment_days,
         p.campaign_types, p.vibes, p.website, p.photos, p.platforms, p.verified, p.updated_at,
         p.verification_status, p.verification_business_name, p.verification_note,
         (SELECT ROUND(AVG(score)::numeric, 1) FROM brand_ratings r WHERE r.brand_id = p.user_id) AS rating_avg,
         (SELECT COUNT(*)::int          FROM brand_ratings r WHERE r.brand_id = p.user_id) AS rating_count,
         u.email, u.role, u.created_at AS member_since
       FROM brand_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  } else {
    const { rows } = await db.query(
      `SELECT
         p.user_id, p.name, p.avatar_url, p.cover_url, p.bio,
         p.categories, p.location, p.lat, p.lng,
         p.age, p.gender, p.platforms, p.photos, p.reels,
         p.followers, p.engagement_rate, p.avg_views,
         p.price_min, p.price_max, p.verified, p.updated_at,
         p.instagram_handle, p.instagram_synced_at, p.worked_with, p.linkedin_reviews,
         u.email, u.role, u.created_at AS member_since
       FROM influencer_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  }
}

// Fields only the owner may see. Exact coordinates would let anyone locate
// a user's home, and emails would let the whole user base be scraped.
// `verification_status` and `verification_note` are the owner's business with
// Matchr: a visitor sees the `verified` flag, not that a review is pending or
// why one was refused. The registration number is never selected at all.
const PRIVATE_PROFILE_FIELDS = [
  'email', 'lat', 'lng', 'instagram_synced_at',
  'verification_status', 'verification_note',
];

const MAX_LINKEDIN_REVIEWS = 10;
const LINKEDIN_HOST = /(^|\.)(linkedin\.com|lnkd\.in)$/i;

// Validates the full replacement list of LinkedIn reviews. Returns the cleaned
// list, or throws an error with status 400 describing the first problem.
function cleanLinkedinReviews(reviews) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  if (!Array.isArray(reviews) || reviews.length > MAX_LINKEDIN_REVIEWS) {
    throw fail(`linkedin_reviews must be a list of up to ${MAX_LINKEDIN_REVIEWS} reviews`);
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const ids = new Set();

  return reviews.map((r) => {
    if (!r || typeof r !== 'object') throw fail('Each review must be an object');
    const quote = str(r.quote);
    const reviewerName = str(r.reviewer_name);
    const reviewerTitle = str(r.reviewer_title);
    const rawUrl = str(r.linkedin_url);

    if (quote.length < 10 || quote.length > 600) throw fail('Review text must be 10 to 600 characters');
    if (!reviewerName || reviewerName.length > 80) throw fail('Reviewer name is required (up to 80 characters)');
    if (reviewerTitle.length > 100) throw fail('Reviewer role must be up to 100 characters');

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw fail('Each review needs a valid LinkedIn link');
    }
    if (url.protocol !== 'https:' || !LINKEDIN_HOST.test(url.hostname)) {
      throw fail('Review links must point to linkedin.com');
    }

    let id = str(r.id);
    if (!/^[\w-]{1,40}$/.test(id) || ids.has(id)) id = crypto.randomUUID();
    ids.add(id);

    const addedAt = Date.parse(r.added_at);
    return {
      id,
      quote,
      reviewer_name: reviewerName,
      reviewer_title: reviewerTitle || null,
      linkedin_url: url.toString(),
      added_at: Number.isNaN(addedAt) ? new Date().toISOString() : new Date(addedAt).toISOString(),
    };
  });
}

function toPublicProfile(profile) {
  const publicProfile = { ...profile };
  for (const field of PRIVATE_PROFILE_FIELDS) delete publicProfile[field];
  return publicProfile;
}

// ─── GET /api/profiles/me ────────────────────────────────────────
async function getMyProfile(req, res, next) {
  try {
    let profile = await fetchProfile(req.user.id, req.user.role);

    if (!profile) {
      // Auto-create a blank profile row so the user sees their profile screen
      // rather than a crash. They can fill it in from the profile edit screen.
      if (req.user.role === 'brand') {
        await db.query(
          `INSERT INTO brand_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
          [req.user.id]
        );
      } else {
        // influencer (or null role – treat as influencer for now)
        await db.query(
          `INSERT INTO influencer_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
          [req.user.id]
        );
      }
      profile = await fetchProfile(req.user.id, req.user.role || 'influencer');
    }

    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/profiles/me ────────────────────────────────────────
async function updateMyProfile(req, res, next) {
  try {
    const { id: userId, role } = req.user;

    if (role === 'brand') {
      // `verified` is deliberately not accepted: only face verification sets it.
      const {
        name, logo_url, cover_url, bio, categories,
        location, lat, lng, budget_min, budget_max, campaign_days, campaign_types, vibes, website, photos, platforms,
        deliverable_reels, deliverable_stories, deliverable_posts, payment_mode, payment_days
      } = req.body;

      await db.query(
        `UPDATE brand_profiles SET
          name                = COALESCE($1,  name),
          logo_url            = COALESCE($2,  logo_url),
          cover_url           = COALESCE($3,  cover_url),
          bio                 = COALESCE($4,  bio),
          categories          = COALESCE($5,  categories),
          location            = COALESCE($6,  location),
          lat                 = COALESCE($7,  lat),
          lng                 = COALESCE($8,  lng),
          budget_min          = COALESCE($9,  budget_min),
          budget_max          = COALESCE($10, budget_max),
          campaign_days       = COALESCE($11, campaign_days),
          campaign_types      = COALESCE($12, campaign_types),
          vibes               = COALESCE($13, vibes),
          website             = COALESCE($14, website),
          photos              = COALESCE($15, photos),
          platforms           = COALESCE($16, platforms),
          deliverable_reels   = COALESCE($17, deliverable_reels),
          deliverable_stories = COALESCE($18, deliverable_stories),
          deliverable_posts   = COALESCE($19, deliverable_posts),
          -- '' clears the mode; COALESCE alone could never unset it.
          payment_mode        = CASE WHEN $20 = '' THEN NULL ELSE COALESCE($20, payment_mode) END,
          payment_days        = COALESCE($21, payment_days)
        WHERE user_id = $22`,
        [name, logo_url, cover_url, bio, categories,
         location, lat, lng, budget_min, budget_max, campaign_days, campaign_types, vibes, website, photos, platforms,
         deliverable_reels, deliverable_stories, deliverable_posts, payment_mode, payment_days,
         userId]
      );
    } else {
      // `verified`, `followers`, `engagement_rate` and `avg_views` are
      // deliberately not accepted: brands rely on them, so only face
      // verification and the Instagram sync may set them.
      const {
        name, avatar_url, cover_url, bio, categories,
        location, lat, lng, age, gender, platforms, photos, reels,
        price_min, price_max, instagram_handle, worked_with, linkedin_reviews
      } = req.body;

      let cleanReviews = null;
      if (linkedin_reviews !== undefined && linkedin_reviews !== null) {
        try {
          cleanReviews = cleanLinkedinReviews(linkedin_reviews);
        } catch (err) {
          if (err.status === 400) return res.status(400).json({ error: err.message });
          throw err;
        }
      }

      let cleanPlatforms = null;
      if (platforms !== undefined && platforms !== null) {
        if (!Array.isArray(platforms) || platforms.length > 20 ||
            platforms.some(p => typeof p !== 'string' || !p.trim() || p.length > 30)) {
          return res.status(400).json({ error: 'platforms must be a list of up to 20 short names' });
        }
        cleanPlatforms = [...new Set(platforms.map(p => p.trim().toLowerCase()))];
      }

      let cleanWorkedWith = null;
      if (worked_with !== undefined && worked_with !== null) {
        if (!Array.isArray(worked_with) || worked_with.length > 30 ||
            worked_with.some(c => typeof c !== 'string' || !c.trim() || c.length > 60)) {
          return res.status(400).json({ error: 'worked_with must be a list of up to 30 company names' });
        }
        const seen = new Set();
        cleanWorkedWith = worked_with.map(c => c.trim()).filter(c => {
          const key = c.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      let preparedReels;
      if (reels !== undefined) {
        const { rows: [current] } = await db.query(
          'SELECT reels FROM influencer_profiles WHERE user_id = $1',
          [userId]
        );
        try {
          preparedReels = await prepareReels(reels, current?.reels, userId);
        } catch (err) {
          if (err.status === 400) return res.status(400).json({ error: err.message });
          throw err;
        }
      }

      await db.query(
        `UPDATE influencer_profiles SET
          name            = COALESCE($1,  name),
          avatar_url      = COALESCE($2,  avatar_url),
          cover_url       = COALESCE($3,  cover_url),
          bio             = COALESCE($4,  bio),
          categories      = COALESCE($5,  categories),
          location        = COALESCE($6,  location),
          lat             = COALESCE($7,  lat),
          lng             = COALESCE($8,  lng),
          age             = COALESCE($9,  age),
          gender          = COALESCE($10, gender),
          platforms       = COALESCE($11, platforms),
          photos          = COALESCE($12, photos),
          reels           = COALESCE($13, reels),
          price_min       = COALESCE($14, price_min),
          price_max       = COALESCE($15, price_max),
          instagram_handle = COALESCE($16, instagram_handle),
          worked_with     = COALESCE($17, worked_with),
          linkedin_reviews = COALESCE($18::jsonb, linkedin_reviews)
        WHERE user_id = $19`,
        [name, avatar_url, cover_url, bio, categories,
         location, lat, lng, age, gender, cleanPlatforms, photos,
         preparedReels !== undefined ? JSON.stringify(preparedReels) : null,
         price_min, price_max,
         instagram_handle,
         cleanWorkedWith,
         cleanReviews ? JSON.stringify(cleanReviews) : null,
         userId]
      );
    }

    // Invalidate the public profile API endpoint cache in Redis
    await invalidateCache(`cache:/api/profiles/${userId}`);
    // Categories, budget and location drive the user's own feed ranking.
    await feedDeck.refreshAfterProfileChange(userId, role);

    const updated = await fetchProfile(userId, role);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/profiles/:userId ───────────────────────────────────
async function getProfileById(req, res, next) {
  try {
    const { userId } = req.params;

    // (We now rely entirely on the Redis cache middleware at the route level)
    // which wraps this entire controller action.

    // Look up role first. A banned or soft-deleted account is a 404 here, not
    // a profile: the feed already excludes them, and a direct link or a stale
    // match row must not be a way back in to the profile they lost.
    const { rows: [user] } = await db.query(
      'SELECT id, role FROM users WHERE id = $1 AND banned = false AND deleted_at IS NULL',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const profile = await fetchProfile(userId, user.role);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    res.json(toPublicProfile(profile));
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/profiles/me/responsiveness ─────────────────────────
//
// How quickly this user answers the people they match with. Measured per
// conversation: the first message from the other side, and the first reply
// after it. A conversation the other side never opened is not counted, and
// one they opened but the user never answered counts against the rate.
//
// Under MIN_RESPONSIVENESS_SAMPLE conversations the numbers say more about
// luck than habit, so the API reports the sample and no figures.
const MIN_RESPONSIVENESS_SAMPLE = 3;

async function getMyResponsiveness(req, res, next) {
  try {
    const { id: userId, role } = req.user;
    const column = role === 'brand' ? 'm.brand_id' : 'm.influencer_id';

    const { rows: [row] } = await db.query(
      `WITH opened AS (
         SELECT m.id AS match_id,
                MIN(msg.created_at) AS first_incoming
         FROM matches m
         JOIN messages msg ON msg.match_id = m.id AND msg.sender_id <> $1
         WHERE ${column} = $1
         GROUP BY m.id
       ), answered AS (
         SELECT o.match_id,
                MIN(msg.created_at) - o.first_incoming AS reply_delay
         FROM opened o
         JOIN messages msg
           ON msg.match_id = o.match_id
          AND msg.sender_id = $1
          AND msg.created_at > o.first_incoming
         GROUP BY o.match_id, o.first_incoming
       )
       SELECT
         (SELECT COUNT(*) FROM opened)   AS conversations,
         (SELECT COUNT(*) FROM answered) AS replied,
         (SELECT EXTRACT(EPOCH FROM percentile_cont(0.5)
                   WITHIN GROUP (ORDER BY reply_delay))
            FROM answered)               AS median_reply_seconds`,
      [userId]
    );

    const conversations = Number(row?.conversations ?? 0);
    const replied = Number(row?.replied ?? 0);
    const enough = conversations >= MIN_RESPONSIVENESS_SAMPLE;
    const medianSeconds = row?.median_reply_seconds == null ? null : Math.round(Number(row.median_reply_seconds));

    res.json({
      conversations,
      replied,
      min_sample: MIN_RESPONSIVENESS_SAMPLE,
      response_rate: enough ? Math.round((replied / conversations) * 100) : null,
      median_reply_seconds: enough ? medianSeconds : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/profiles/me/verification ──────────────────────────
//
// A brand asks to be verified as a business. Nothing here sets `verified`:
// an admin does that after checking the details (adminController.reviewVerification).
async function requestVerification(req, res, next) {
  try {
    const { id: userId, role } = req.user;
    if (role !== 'brand') return res.status(403).json({ error: 'Only brands can request business verification' });

    const businessName = String(req.body.business_name || '').trim();
    const regNumber = String(req.body.reg_number || '').trim();

    const { rows: [current] } = await db.query(
      'SELECT verification_status FROM brand_profiles WHERE user_id = $1',
      [userId]
    );
    if (!current) return res.status(404).json({ error: 'Profile not found' });
    if (current.verification_status === 'approved') {
      return res.status(409).json({ error: 'This brand is already verified' });
    }
    if (current.verification_status === 'pending') {
      return res.status(409).json({ error: 'A verification request is already under review' });
    }

    const { rows: [updated] } = await db.query(
      `UPDATE brand_profiles SET
         verification_status        = 'pending',
         verification_business_name = $1,
         verification_reg_number    = $2,
         verification_submitted_at  = NOW(),
         verification_reviewed_at   = NULL,
         verification_note          = NULL,
         updated_at                 = NOW()
       WHERE user_id = $3
       RETURNING verification_status, verification_business_name, verification_submitted_at`,
      [businessName, regNumber, userId]
    );

    await invalidateCache(`cache:/api/profiles/${userId}`);
    logger.info({ userId }, 'Business verification requested');
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/profiles/verify-face ──────────────────────────────
async function verifyFace(req, res, next) {
  try {
    const { base64Image } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: 'Base64 image string is required' });
    }

    const profile = await fetchProfile(req.user.id, req.user.role);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Use avatar_url or first photo as the reference image
    const referenceImageUrl = profile.avatar_url || (profile.photos && profile.photos[0]);
    if (!referenceImageUrl) {
      return res.status(400).json({ error: 'Please upload at least one profile picture before verifying.' });
    }

    // The reference URL is user-editable, so only fetch files from this user's
    // own uploads — otherwise the server could be pointed at internal hosts.
    if (!isOwnUploadUrl(referenceImageUrl, req.user.id)) {
      return res.status(400).json({ error: 'Please re-upload your profile picture before verifying.' });
    }

    // Download the reference image
    const response = await fetch(referenceImageUrl, { redirect: 'error' });
    if (!response.ok) {
      throw new Error('Failed to download reference image for verification');
    }
    const arrayBuffer = await response.arrayBuffer();
    const referenceBuffer = Buffer.from(arrayBuffer);

    // Convert the captured base64 string to a Buffer
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const capturedBuffer = Buffer.from(base64Data, 'base64');

    // Compare faces using Rekognition
    const { verifyFaceMatch } = require('../services/faceVerificationService');
    const result = await verifyFaceMatch(referenceBuffer, capturedBuffer);

    if (result.isMatch) {
      // Update verification status in DB
      const table = req.user.role === 'brand' ? 'brand_profiles' : 'influencer_profiles';
      await db.query(`UPDATE ${table} SET verified = true, updated_at = NOW() WHERE user_id = $1`, [req.user.id]);
      await invalidateCache(`cache:/api/profiles/${req.user.id}`);
      
      return res.json({ success: true, message: 'Profile verified successfully', similarity: result.similarity });
    } else {
      return res.status(400).json({ error: result.error || 'Face verification failed. Faces do not match.' });
    }
  } catch (err) {
    logger.error('Error during face verification:', err);
    res.status(500).json({ error: 'An internal error occurred during verification' });
  }
}

// ─── POST /api/profiles/sync-instagram ───────────────────────────
async function syncInstagram(req, res, next) {
  try {
    const { id: userId, role } = req.user;

    if (role !== 'influencer') {
      return res.status(403).json({ error: 'Only influencers can sync Instagram data' });
    }

    let { instagram_handle } = req.body;
    if (!instagram_handle || typeof instagram_handle !== 'string') {
      return res.status(400).json({ error: 'instagram_handle is required' });
    }

    // Strip leading @ if present, trim whitespace
    instagram_handle = instagram_handle.replace(/^@/, '').trim().toLowerCase();

    // Validate handle format (letters, numbers, dots, underscores, 1-30 chars)
    if (!/^[a-z0-9._]{1,30}$/.test(instagram_handle)) {
      return res.status(400).json({ error: 'Invalid Instagram handle format' });
    }

    // ── Check 24-hour cooldown ───────────────────────────────────
    const { rows: [existing] } = await db.query(
      'SELECT instagram_synced_at, instagram_handle FROM influencer_profiles WHERE user_id = $1',
      [userId]
    );

    // Apply cooldown ONLY if they are trying to sync the exact same handle
    if (existing?.instagram_synced_at && existing?.instagram_handle === instagram_handle) {
      const lastSync = new Date(existing.instagram_synced_at);
      const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSync < 24) {
        const hoursRemaining = Math.ceil(24 - hoursSinceSync);
        return res.status(429).json({
          error: `Instagram was synced recently. Try again in ${hoursRemaining} hour(s).`,
        });
      }
    }

    // ── Call Apify service ───────────────────────────────────────
    const { syncInstagramProfile } = require('../services/instagramSyncService');
    const result = await syncInstagramProfile(instagram_handle);

    if (!result) {
      return res.status(502).json({
        error: 'Could not fetch Instagram data. The profile may be private or the handle may be incorrect.',
      });
    }

    const reels = await persistSyncedThumbnails(result.reels, userId);

    // ── Update the influencer profile ────────────────────────────
    await db.query(
      `UPDATE influencer_profiles SET
        followers          = $1,
        engagement_rate    = $2,
        avg_views          = $3,
        instagram_handle   = $4,
        instagram_synced_at = NOW(),
        reels              = $6
      WHERE user_id = $5`,
      [result.followers, result.engagement_rate, result.avg_views, instagram_handle, userId, JSON.stringify(reels)]
    );

    // Invalidate cached profile
    await invalidateCache(`cache:/api/profiles/${userId}`);

    const updated = await fetchProfile(userId, role);
    logger.info({ userId, instagram_handle, followers: result.followers }, 'Instagram sync completed');
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// Results are shared across instances: each miss runs a paid scraper.
const IG_SEARCH_TTL_SECONDS = 5 * 60;

// ─── GET /api/profiles/search-instagram ─────────────────────────
async function searchInstagram(req, res, next) {
  try {
    let { q } = req.query;
    if (typeof q !== 'string' || q.length < 3) return res.json([]);

    q = q.replace('@', '').toLowerCase().trim();

    // Return cached result if still fresh
    const cacheKey = `ig-search:${q}`;
    const cached = await sharedCache.get(cacheKey);
    if (cached) return res.json(cached);

    // Use Apify search service
    const { searchInstagramProfiles } = require('../services/instagramSyncService');
    const rawUsernames = await searchInstagramProfiles(q);
    
    // Format them with @ symbol
    const usernames = rawUsernames
      .filter(Boolean)
      .map(username => `@${username}`);

    // Always ensure the exact typed query is an option, so users can select un-searchable handles
    if (q && !usernames.includes(`@${q}`)) {
      usernames.unshift(`@${q}`);
    }

    await sharedCache.set(cacheKey, usernames, IG_SEARCH_TTL_SECONDS);

    res.json(usernames);
  } catch (err) {
    logger.error('Failed to fetch Instagram users:', err);
    res.status(500).json({ error: 'Failed to search Instagram users' });
  }
}

module.exports = { getMyProfile, updateMyProfile, getProfileById, getMyResponsiveness, requestVerification, verifyFace, syncInstagram, searchInstagram };
