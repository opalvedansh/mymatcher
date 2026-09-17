const db = require('../config/db');
const redisClient = require('../config/redis');
const logger = require('../config/logger');

/**
 * POST /api/auth/sync
 *
 * Called immediately after Firebase sign-up OR sign-in.
 * Body: { role: 'brand' | 'influencer' }  (only required on first sync)
 *
 * Upserts the user row in PostgreSQL and creates an empty profile
 * row if the user is new. Safe to call multiple times (idempotent).
 *
 * Returns: { user: { id, email, role } }
 */
async function syncUser(req, res, next) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id: uid, email } = req.user;  // set by authenticate middleware
    const { role } = req.body;            // only needed on first call

    // 1. Upsert the user row
    const { rows: [user] } = await client.query(
      `INSERT INTO users (id, email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             role  = COALESCE(users.role, EXCLUDED.role)
       RETURNING id, email, role, created_at`,
      [uid, email || '', role || null]
    );

    // 2. Create an empty profile row if this is the first sync
    if (user.role === 'brand') {
      await client.query(
        `INSERT INTO brand_profiles (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid]
      );
    } else if (user.role === 'influencer') {
      await client.query(
        `INSERT INTO influencer_profiles (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid]
      );
    }

    await client.query('COMMIT');

    // Invalidate after COMMIT, and never let it fail the request: a Redis
    // blip must not roll back a user row that was created successfully.
    if (redisClient) {
      try {
        await redisClient.del(`user:session:${uid}`);
      } catch (cacheErr) {
        logger.warn({ err: cacheErr.message, uid }, 'Failed to invalidate session cache after sync');
      }
    }

    return res.status(200).json({ user });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ─── GET /api/auth/me ────────────────────────────────────────────
async function me(req, res, next) {
  try {
    const { rows } = await db.query(
      'SELECT id, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0] || null;
    if (user) {
      const adminIds = (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
      user.is_admin = adminIds.includes(user.id);
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/auth/onboarding ────────────────────────────────────
async function getOnboardingData(req, res, next) {
  try {
    const { rows } = await db.query(
      'SELECT onboarding_data FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(rows[0]?.onboarding_data || {});
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/auth/onboarding ────────────────────────────────────
async function updateOnboardingData(req, res, next) {
  try {
    // Upsert, not update: onboarding progress is saved before the user has
    // picked a role, which is the point at which their row would be created.
    // `role` stays NULL here, so the client still treats onboarding as pending.
    const { rows } = await db.query(
      `INSERT INTO users (id, email, onboarding_data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET onboarding_data = users.onboarding_data || EXCLUDED.onboarding_data,
             updated_at      = now()
       RETURNING onboarding_data`,
      [req.user.id, req.user.email || '', JSON.stringify(req.body)]
    );

    if (redisClient) {
      await redisClient.del(`user:session:${req.user.id}`);
    }

    res.json(rows[0]?.onboarding_data || {});
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/auth/push-token ────────────────────────────────────
async function updatePushToken(req, res, next) {
  try {
    const token = req.body.token ?? null;
    if (token) {
      // A phone belongs to whoever signed in last; stop sending it other accounts' notifications.
      await db.query(
        `UPDATE users SET expo_push_token = NULL, updated_at = now()
         WHERE expo_push_token = $1 AND id <> $2`,
        [token, req.user.id]
      );
    }
    await db.query(
      `UPDATE users SET expo_push_token = $1, updated_at = now() WHERE id = $2`,
      [token, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { syncUser, me, getOnboardingData, updateOnboardingData, updatePushToken };
