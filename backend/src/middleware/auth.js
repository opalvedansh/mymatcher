const { verifySupabaseToken } = require('../utils/verifyToken');
const db     = require('../config/db');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

/**
 * Middleware — verifies the Supabase ID token in the Authorization header.
 * Attaches { id, email, role } to req.user on success.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);

    let uid, email;
    try {
      const verified = await verifySupabaseToken(token);
      uid = verified.sub;
      email = verified.email;
    } catch (jwtErr) {
      // We could not reach the signing keys, so the token is unproven rather
      // than invalid. A 401 here would make the client discard a valid session.
      if (jwtErr.code === 'JWKS_UNAVAILABLE') {
        logger.error({ jwtErr: jwtErr.message }, 'Auth unavailable — cannot reach Supabase JWKS');
        return res.status(503).json({
          error: 'Authentication temporarily unavailable. Please try again.',
          code: 'auth_unavailable',
        });
      }
      logger.warn({ jwtErr: jwtErr.message }, 'Token verification failed');
      return res.status(401).json({ error: 'Invalid Supabase token', details: jwtErr.message });
    }

    // Try Redis Cache First
    const cacheKey = `user:session:${uid}`;
    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        req.user = JSON.parse(cached);
        if (req.user.banned) {
          return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
        }
        return next();
      }
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
      await redisClient.setex(cacheKey, 300, JSON.stringify(req.user));
    }

    // Check if user is banned
    if (req.user.banned) {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
    }

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

module.exports = { authenticate, requireRole };
