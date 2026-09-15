const jwt = require('jsonwebtoken');
const { createPublicKey } = require('crypto');
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

// ─── JWKS (asymmetric signing keys) ───────────────────────────────
// Supabase projects using JWT signing keys issue ES256/RS256 tokens that
// cannot be verified with the legacy shared SUPABASE_JWT_SECRET.
const JWKS_URL = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
// Bounds how often an unrecognised `kid` can trigger an outbound fetch.
const JWKS_REFRESH_COOLDOWN_MS = 60_000;

/**
 * Signals that we could not reach the JWKS endpoint, so the token could be
 * neither proven valid nor proven invalid. Callers must surface this as 503,
 * never 401 — a 401 makes the client discard a perfectly good session.
 */
class JwksUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JwksUnavailableError';
    this.code = 'JWKS_UNAVAILABLE';
  }
}

let jwksCache = new Map();
let jwksLastAttempt = 0;
let jwksHealthy = false;
let jwksInflight = null;

function refreshJwks() {
  if (jwksInflight) return jwksInflight;

  jwksInflight = (async () => {
    try {
      const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { keys } = await res.json();
      const next = new Map();
      for (const jwk of keys || []) {
        if (!jwk.kid) continue;
        try {
          next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
        } catch (err) {
          logger.warn({ kid: jwk.kid, err: err.message }, 'Skipping unusable JWK');
        }
      }

      jwksCache = next;
      jwksHealthy = true;
      logger.info({ keyCount: next.size }, '[Auth] JWKS refreshed');
      return next;
    } catch (err) {
      jwksHealthy = false;
      logger.error({ err: err.message }, '[Auth] JWKS fetch failed');
      throw new JwksUnavailableError(`Could not fetch signing keys: ${err.message}`);
    } finally {
      // Stamped on failure too, so a persistent outage cannot spin the cooldown.
      jwksLastAttempt = Date.now();
    }
  })().finally(() => { jwksInflight = null; });

  return jwksInflight;
}

/**
 * Resolves the public key for a token's `kid`.
 * Returns null when the key is genuinely absent from a freshly fetched JWKS
 * (an invalid token); throws JwksUnavailableError when we simply cannot tell.
 */
async function getSigningKey(kid) {
  if (kid && jwksCache.has(kid)) return jwksCache.get(kid);

  if (Date.now() - jwksLastAttempt < JWKS_REFRESH_COOLDOWN_MS) {
    if (jwksHealthy) return null; // cache is fresh and authoritative
    throw new JwksUnavailableError('Signing keys unavailable (fetch recently failed)');
  }

  await refreshJwks();
  return kid ? jwksCache.get(kid) ?? null : null;
}

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
 * 1. Tries local jwt.verify with SUPABASE_JWT_SECRET if available.
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

  // Safe diagnostics (Step 3 & 11) - Do NOT log the token value itself
  const jwtParts = token.split('.');
  const secret = process.env.SUPABASE_JWT_SECRET;
  
  // Structural validation before passing to parsers
  if (jwtParts.length !== 3) {
    throw new Error('jwt malformed: token must have 3 parts');
  }

  const header = jwt.decode(token, { complete: true })?.header;
  if (!header?.alg) {
    throw new Error('jwt malformed: missing algorithm header');
  }

  logger.info({
    tokenLength: token.length,
    jwtPartCount: jwtParts.length,
    alg: header.alg,
    verificationStrategy: header.alg === 'HS256'
      ? (secret ? 'local_hs256' : 'supabase_api_circuit_breaker')
      : 'local_jwks',
  }, 'Starting token verification');

  // Strategy 1a: Asymmetric verify against the project's JWKS (ES256/RS256).
  // Local verification failures are terminal — we do NOT fall back to the
  // Supabase API, so invalid tokens cannot be spammed to exhaust rate limits.
  if (header.alg !== 'HS256') {
    const key = await getSigningKey(header.kid);
    if (!key) {
      throw new Error(`Invalid token: unknown signing key (kid=${header.kid ?? 'none'})`);
    }
    try {
      const decoded = jwt.verify(token, key, {
        algorithms: ['ES256', 'RS256'],
        audience: 'authenticated',
      });
      if (decoded && decoded.sub) {
        return { sub: decoded.sub, email: decoded.email || '' };
      }
      throw new Error('token payload missing sub claim');
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        throw new Error('Token expired — please re-authenticate');
      }
      logger.error({ err: jwtErr.message, alg: header.alg }, 'JWKS verify failed');
      throw new Error(`Invalid token: ${jwtErr.message}`);
    }
  }

  // Strategy 1b: Legacy symmetric verify with the shared secret.
  // Supabase's JWT secret is a UTF-8 string. Do NOT base64 decode it.
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

module.exports = { verifySupabaseToken, JwksUnavailableError };
