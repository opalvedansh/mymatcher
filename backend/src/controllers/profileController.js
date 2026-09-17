const db = require('../config/db');
const { invalidateCache } = require('../middleware/cacheMiddleware');
const logger = require('../config/logger');
const { isOwnUploadUrl } = require('../utils/storage');
const sharedCache = require('../utils/sharedCache');
const feedDeck = require('../services/feedDeck');

// ─── Helper: fetch full profile by userId + role (explicit columns) ──
async function fetchProfile(userId, role) {
  if (role === 'brand') {
    const { rows } = await db.query(
      `SELECT
         p.user_id, p.name, p.logo_url, p.cover_url, p.bio,
         p.categories, p.location, p.lat, p.lng,
         p.budget_min, p.budget_max, p.campaign_days,
         p.campaign_types, p.vibes, p.website, p.photos, p.platforms, p.verified, p.updated_at,
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
         p.instagram_handle, p.instagram_synced_at,
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
const PRIVATE_PROFILE_FIELDS = ['email', 'lat', 'lng', 'instagram_synced_at'];

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
        location, lat, lng, budget_min, budget_max, campaign_days, campaign_types, vibes, website, photos, platforms
      } = req.body;

      await db.query(
        `UPDATE brand_profiles SET
          name           = COALESCE($1,  name),
          logo_url       = COALESCE($2,  logo_url),
          cover_url      = COALESCE($3,  cover_url),
          bio            = COALESCE($4,  bio),
          categories     = COALESCE($5,  categories),
          location       = COALESCE($6,  location),
          lat            = COALESCE($7,  lat),
          lng            = COALESCE($8,  lng),
          budget_min     = COALESCE($9,  budget_min),
          budget_max     = COALESCE($10, budget_max),
          campaign_days  = COALESCE($11, campaign_days),
          campaign_types = COALESCE($12, campaign_types),
          vibes          = COALESCE($13, vibes),
          website        = COALESCE($14, website),
          photos         = COALESCE($15, photos),
          platforms      = COALESCE($16, platforms)
        WHERE user_id = $17`,
        [name, logo_url, cover_url, bio, categories,
         location, lat, lng, budget_min, budget_max, campaign_days, campaign_types, vibes, website, photos, platforms,
         userId]
      );
    } else {
      // `verified`, `followers`, `engagement_rate` and `avg_views` are
      // deliberately not accepted: brands rely on them, so only face
      // verification and the Instagram sync may set them.
      const {
        name, avatar_url, cover_url, bio, categories,
        location, lat, lng, age, gender, platforms, photos, reels,
        price_min, price_max, instagram_handle
      } = req.body;

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
          instagram_handle = COALESCE($16, instagram_handle)
        WHERE user_id = $17`,
        [name, avatar_url, cover_url, bio, categories,
         location, lat, lng, age, gender, platforms, photos,
         reels !== undefined ? JSON.stringify(reels) : null,
         price_min, price_max,
         instagram_handle,
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

    // Look up role first
    const { rows: [user] } = await db.query(
      'SELECT id, role FROM users WHERE id = $1',
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
      [result.followers, result.engagement_rate, result.avg_views, instagram_handle, userId, JSON.stringify(result.reels)]
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

module.exports = { getMyProfile, updateMyProfile, getProfileById, verifyFace, syncInstagram, searchInstagram };
