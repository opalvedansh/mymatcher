const { verifySupabaseToken } = require('../utils/verifyToken');
const db     = require('../config/db');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

const SUSPENDED = { error: 'Your account has been suspended. Contact support.' };

/**
 * Verifies the Bearer token and resolves the caller's identity from its claims.
 * Returns { uid, email }, or null after having already sent an error response.
 */
async function resolveTokenIdentity(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return null;
  }

  try {
    const { sub: uid, email } = await verifySupabaseToken(authHeader.slice(7));
    return { uid, email };
  } catch (jwtErr) {
    // We could not reach the signing keys, so the token is unproven rather
    // than invalid. A 401 here would make the client discard a valid session.
    if (jwtErr.code === 'JWKS_UNAVAILABLE') {
      logger.error({ jwtErr: jwtErr.message }, 'Auth unavailable — cannot reach Supabase JWKS');
      res.status(503).json({
        error: 'Authentication temporarily unavailable. Please try again.',
        code: 'auth_unavailable',
      });
      return null;
    }
    logger.warn({ jwtErr: jwtErr.message }, 'Token verification failed');
    res.status(401).json({ error: 'Invalid Supabase token', details: jwtErr.message });
    return null;
  }
}

/**
 * Middleware — verifies the Supabase ID token in the Authorization header.
 * Attaches { id, email, role } to req.user on success.
 * Requires an existing users row; 403s with `profile_incomplete` otherwise.
 */
async function authenticate(req, res, next) {
  try {
    const identity = await resolveTokenIdentity(req, res);
    if (!identity) return;
    const { uid } = identity;

    // The cache is an optimisation: if Redis is unavailable, fall through to
    // the database rather than failing every authenticated request.
    const cacheKey = `user:session:${uid}`;
    let cached = null;
    if (redisClient) {
      try {
        cached = await redisClient.get(cacheKey);
      } catch (err) {
        logger.warn({ err: err.message }, 'Session cache read failed; using database');
      }
    }
    if (cached) {
      req.user = JSON.parse(cached);
      if (req.user.banned) {
        return res.status(403).json(SUSPENDED);
      }
      return next();
    }

    // Cache miss or Redis unavailable — query DB
    const { rows } = await db.query(
      'SELECT id, email, role, banned FROM users WHERE id = $1',
      [uid]
    );

    if (!rows.length) {
      // User is not in our DB yet. Return 403 to trigger onboarding flow, 
      // instead of creating a ghost user here.
      return res.status(403).json({ error: 'Profile incomplete', code: 'profile_incomplete' });
    }

    req.user = rows[0];

    // Populate Cache (5 minute TTL)
    if (redisClient) {
      redisClient.setex(cacheKey, 300, JSON.stringify(req.user)).catch((err) => {
        logger.warn({ err: err.message }, 'Session cache write failed');
      });
    }

    // Check if user is banned
    if (req.user.banned) {
      return res.status(403).json(SUSPENDED);
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware — like `authenticate`, but does NOT require an existing users row.
 * Attaches { id, email } straight from the verified token claims.
 *
 * This exists to break a chicken-and-egg deadlock: the endpoints that create a
 * user's row cannot sit behind a check that the row already exists. Use it only
 * on those bootstrap routes; everything else should use `authenticate`.
 */
async function authenticateTokenOnly(req, res, next) {
  try {
    const identity = await resolveTokenIdentity(req, res);
    if (!identity) return;
    const { uid, email } = identity;

    // A missing row is expected here, but an existing banned one still blocks.
    const { rows } = await db.query('SELECT banned FROM users WHERE id = $1', [uid]);
    if (rows.length && rows[0].banned) {
      return res.status(403).json(SUSPENDED);
    }

    req.user = { id: uid, email };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware factory — restrict access to specific roles.
 * Usage:  router.get('/...', authenticate, requireRole('brand'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({
        error: `Access restricted to: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = { authenticate, authenticateTokenOnly, requireRole };
