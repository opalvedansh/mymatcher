const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { redisStore, limiterDefaults } = require('./rateLimitStore');

/**
 * Admin rate limits.
 *
 * Keyed on req.user.id, which by the time these run has come from a *verified*
 * token (authenticateTokenOnly). The app's userOrIpKey decodes the JWT without
 * verifying it; that is fine for consumer routes but not for a staff surface.
 */
const byAdmin = (req) => (req.user?.id ? `admin:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`);

// Counters are process-wide and in-memory without Redis, so under test they
// would carry across cases in a file — and a suite that deliberately exercises
// 403 paths trips adminAuthFailLimiter within a dozen assertions. Same reason
// rateLimitStore returns undefined and queue.js disables BullMQ in test.
// LIMITS below is exported so the configuration itself stays assertable.
const IS_TEST = process.env.NODE_ENV === 'test';
const skip = () => IS_TEST;

const LIMITS = {
  all: { windowMs: 5 * 60_000, max: 300 },
  write: { windowMs: 5 * 60_000, max: 60 },
  export: { windowMs: 60 * 60_000, max: 5 },
  messages: { windowMs: 60 * 60_000, max: 10 },
  broadcast: { windowMs: 60 * 60_000, max: 5 },
  authfail: { windowMs: 10 * 60_000, max: 10 },
};

function make(name, windowMs, max, message) {
  return rateLimit({
    ...limiterDefaults,
    windowMs,
    max,
    skip,
    keyGenerator: byAdmin,
    store: redisStore(`rl:admin:${name}:`),
    message: { error: message },
  });
}

// Whole router. Generous: a dashboard legitimately fans out several requests
// per screen, and the write limiter is the one that matters.
const adminLimiter = make('all', LIMITS.all.windowMs, LIMITS.all.max, 'Too many admin requests');

const adminWriteLimiter = make('write', LIMITS.write.windowMs, LIMITS.write.max, 'Too many admin writes');

const adminExportLimiter = make('export', LIMITS.export.windowMs, LIMITS.export.max, 'Export limit reached, try again later');

// Reading someone's private conversation is the most sensitive thing this API
// can do. Ten an hour is enough to work a moderation queue and not enough to
// exfiltrate a user base.
const adminMessageLimiter = make('messages', LIMITS.messages.windowMs, LIMITS.messages.max, 'Message read limit reached');

const adminBroadcastLimiter = make('broadcast', LIMITS.broadcast.windowMs, LIMITS.broadcast.max, 'Broadcast limit reached');

/**
 * Counts rejected admin attempts per IP.
 *
 * Without this, /api/admin/* is an oracle for probing whether a stolen token
 * belongs to an admin: try it, read the status code. Only globalLimiter's
 * 200/min would stand in the way. skipSuccessfulRequests means a working
 * admin never touches this counter.
 */
const adminAuthFailLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: LIMITS.authfail.windowMs,
  max: LIMITS.authfail.max,
  skip,
  skipSuccessfulRequests: true,
  // Deliberately IP-keyed: the point is the caller is not an admin, so there
  // is no trustworthy user identity to key on.
  store: redisStore('rl:admin:authfail:'),
  message: { error: 'Too many failed admin attempts' },
});

module.exports = {
  adminLimiter,
  adminWriteLimiter,
  adminExportLimiter,
  adminMessageLimiter,
  adminBroadcastLimiter,
  adminAuthFailLimiter,
  LIMITS,
};
