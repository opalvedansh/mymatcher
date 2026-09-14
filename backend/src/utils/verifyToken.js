const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const CircuitBreaker = require('opossum');
const logger = require('../config/logger');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_ANON_KEY must be set.'
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Direct supabase verification (used as fallback when circuit is open)
async function verifyViaSupabaseAPI(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error) throw error;
  return data;
}

const supabaseAuthBreaker = new CircuitBreaker(verifyViaSupabaseAPI, {
  timeout: 8000,                  // wait up to 8s
  errorThresholdPercentage: 80,   // only open after 80% failures (was 50%)
  resetTimeout: 5000,             // try to close again after 5s (was 10s)
  capacity: 50,
  errorFilter: (err) => {
    // Client auth errors (invalid token, missing session, 4xx) should not trip the breaker
    if (err?.status >= 400 && err?.status < 500) return true;
    if (err?.message && (
      err.message.includes('Auth session missing') ||
      err.message.includes('Invalid') ||
      err.message.includes('expired')
    )) {
      return true;
    }
    return false;
  }
});

supabaseAuthBreaker.on('open', () => logger.warn('[CircuitBreaker] Supabase API circuit OPEN'));
supabaseAuthBreaker.on('halfOpen', () => logger.info('[CircuitBreaker] Supabase API circuit HALF-OPEN — testing'));
supabaseAuthBreaker.on('close', () => logger.info('[CircuitBreaker] Supabase API circuit CLOSED — restored'));

/**
 * Verifies a Supabase JWT access token.
 * 1. Tries local jwt.verify with SUPABASE_JWT_SECRET (base64-decoded) if available.
 * 2. Tries supabase.auth.getUser(token) via circuit breaker.
 * 3. If circuit is open, falls back to a direct API call bypassing the breaker.
 *
 * @param {string} token - The Bearer access token string
 * @returns {Promise<{ sub: string, email: string }>}
 */
async function verifySupabaseToken(token) {
  if (!token) {
    throw new Error('Token is missing');
  }

  // Strategy 1: Local JWT verify with secret
  // Supabase's JWT secret is a UTF-8 string. Do NOT base64 decode it.
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        audience: 'authenticated'
      });
      if (decoded && decoded.sub) {
        return { sub: decoded.sub, email: decoded.email || '' };
      }
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        throw new Error('Token expired — please re-authenticate');
      }
      // If local verification fails (e.g. invalid signature, malformed), the token is invalid.
      // Do NOT fall back to Supabase API, as attackers could spam invalid tokens to exhaust our rate limits.
      logger.error({ err: jwtErr.message }, 'Local JWT verify failed');
      throw new Error(`Invalid token: ${jwtErr.message}`);
    }
  }

  // Strategy 2: Validate via Supabase Auth API (with circuit breaker)
  // This is now only reached if SUPABASE_JWT_SECRET is completely missing from .env
  let breakerOpen = false;
  try {
    const data = await supabaseAuthBreaker.fire(token);
    if (data?.user) {
      return { sub: data.user.id, email: data.user.email || '' };
    }
  } catch (apiErr) {
    if (apiErr.code === 'EOPENBREAKER') {
      // Circuit is open — fall through to direct fallback below
      breakerOpen = true;
      logger.warn('[Auth] Circuit breaker open — attempting direct Supabase API call');
    } else if (apiErr.code === 'ETIMEDOUT') {
      logger.error('[Auth] Supabase auth API timed out');
    } else {
      logger.warn({ err: apiErr.message }, 'Supabase auth.getUser API check failed');
    }
  }

  // Strategy 3: Direct API call bypassing the circuit breaker
  // Handles the case where the breaker opened due to transient errors
  // but Supabase is actually available now.
  if (breakerOpen) {
    try {
      const data = await verifyViaSupabaseAPI(token);
      if (data?.user) {
        logger.info('[Auth] Direct Supabase API call succeeded (circuit was open)');
        return { sub: data.user.id, email: data.user.email || '' };
      }
    } catch (directErr) {
      logger.warn({ err: directErr.message }, 'Direct Supabase API call also failed');
    }
  }

  // All strategies failed — reject the token
  logger.error('Token verification failed: all verification strategies exhausted');
  throw new Error('Invalid Supabase token');
}

module.exports = { verifySupabaseToken };
