require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const jwt          = require('jsonwebtoken');
const { redisStore: getRedisStore, limiterDefaults } = require('./config/rateLimitStore');
const http         = require('http');
const pinoHttp     = require('pino-http');
const Sentry       = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');
const swaggerUi    = require('swagger-ui-express');
const swaggerSpec  = require('./config/swagger');
const logger       = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');
const { initSocket, closeSocket } = require('./socket');
const { startWorkers, stopWorkers } = require('./config/queue');
const { healthBody, onShutdown, closeDatabase, closeRedis } = require('./lifecycle');
const compression  = require('compression');
const shrinkRay    = require('shrink-ray-current');
// ─── Sentry (activates only when DSN is set) ─────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2, // 20% of transactions for performance monitoring
    profilesSampleRate: 0.2,
    integrations: [
      nodeProfilingIntegration(),
    ],
  });
  logger.info('Sentry error tracking & profiling enabled');
}

// ─── Route modules ───────────────────────────────────────────────
const authRoutes    = require('./routes/auth');
const profileRoutes = require('./routes/profiles');
const feedRoutes    = require('./routes/feed');
const swipeRoutes   = require('./routes/swipes');
const matchRoutes   = require('./routes/matches');
const chatRoutes    = require('./routes/chat');
const uploadRoutes  = require('./routes/upload');
const adminRoutes   = require('./routes/admin');
const storiesRoutes = require('./routes/stories');
const mapsRoutes    = require('./routes/maps');
const postsRoutes   = require('./routes/posts');
const safetyRoutes  = require('./routes/safety');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ─── Allowed origins ─────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:8081',   // Expo web dev server
  'http://localhost:3000',   // Local API (health check)
  'http://localhost:19006',  // Expo web (older port)
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : []),
];

// ─── Rate limiters (Redis-backed when available, in-memory fallback) ──
// Keys authenticated traffic per user, not per IP: mobile carriers put many
// phones behind one address, so an IP key lets users exhaust each other's quota.
// The sub is read without verification — a forged one only earns a fresh bucket
// for a request `authenticate` then rejects, and globalLimiter still caps the IP.
function userOrIpKey(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const sub = jwt.decode(header.slice(7))?.sub;
    if (typeof sub === 'string' && sub) return `user:${sub}`;
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
}

const authLimiter = rateLimit({
  store: getRedisStore('rl:auth:'),
  windowMs: 15 * 60 * 1000,  // 15 minutes
  // One onboarding run makes ~25 requests here (a save per screen plus startup
  // fetches), so this leaves room for several retries.
  max: process.env.NODE_ENV === 'development' ? 3000 : 150,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many auth requests — try again in 15 minutes' },
  ...limiterDefaults,
});

const globalLimiter = rateLimit({
  store: getRedisStore('rl:global:'),
  windowMs: 60 * 1000,       // 1 minute
  max: 200,                  // 200 requests per minute per IP
  message: { error: 'Global rate limit exceeded' },
  ...limiterDefaults,
});

const swipeLimiter = rateLimit({
  store: getRedisStore('rl:swipe:'),
  windowMs: 60 * 1000,       // 1 minute
  max: 100,                  // 100 swipes/min per user
  keyGenerator: userOrIpKey,
  message: { error: 'Swipe rate limit exceeded' },
  ...limiterDefaults,
});

// ─── Global middleware ───────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (native mobile apps, curl, etc.)
    if (!origin) return cb(null, true);

    // Allow all localhost and 127.0.0.1 origins on any port (for Expo Web, Vite, dev)
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }

    if (ALLOWED_ORIGINS.includes(origin) || process.env.ALLOWED_ORIGINS === '*') {
      return cb(null, true);
    }

    return cb(null, false);
  },
  credentials: true,
}));
app.use(pinoHttp({ logger }));
// ─── Compression (brotli preferred, gzip fallback) ─────────────────
// - Skips payloads already compressed (images, audio, video, zip)
// - threshold: 1 KB — don't compress tiny JSON like {"status":"ok"}
// - brotli quality 4: fast enough for dynamic API responses
const ALREADY_COMPRESSED_RE = /^(image|audio|video)\//i;
app.use(shrinkRay({
  threshold:   1024,
  brotli:      { quality: 4 },
  filter: (req, res) => {
    const ct = res.getHeader('Content-Type') || '';
    if (ALREADY_COMPRESSED_RE.test(ct)) return false;          // skip binary types
    if (/zip|gzip|br|compress/.test(ct))  return false;        // already compressed
    return shrinkRay.filter(req, res);                         // default logic for the rest
  },
}));
// Global JSON limit is intentionally small — file uploads use presigned S3 URLs
// and never send large bodies through this API.
const jsonParser = express.json({ limit: '50kb' });
// Face verification carries a base64 selfie and parses its own larger body.
const LARGE_BODY_PATHS = new Set(['/api/profiles/verify-face']);
app.use((req, res, next) => (LARGE_BODY_PATHS.has(req.path) ? next() : jsonParser(req, res, next)));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(globalLimiter);

// ─── Health check ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json(healthBody('api')));

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/auth',     authLimiter,  authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/feed',     feedRoutes);
app.use('/api/swipes',   swipeLimiter, swipeRoutes);
app.use('/api/matches',  matchRoutes);
app.use('/api/chat',     chatRoutes);
app.use('/api/upload',   uploadRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/stories',  storiesRoutes);
app.use('/api/maps',     mapsRoutes);
app.use('/api/posts',    postsRoutes);
app.use('/api',          safetyRoutes);

// ─── API Documentation ───────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── 404 handler ─────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── Sentry error handler (before custom handler) ───────────────
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ─── Central error handler (must be last) ────────────────────────
app.use(errorHandler);

// ─── Start server ────────────────────────────────────────────────
// ENABLE_SOCKETS=false once chat runs as its own service (npm run chat);
// RUN_WORKERS=false once jobs run as their own service (npm run worker).
const SOCKETS_ENABLED = process.env.ENABLE_SOCKETS !== 'false';
const WORKERS_ENABLED = process.env.RUN_WORKERS !== 'false';

const server = http.createServer(app);
if (SOCKETS_ENABLED) initSocket(server);
if (WORKERS_ENABLED) startWorkers();

server.listen(PORT, () => {
  console.log(`\n🚀 Matcherc API running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database    : ${process.env.DATABASE_URL?.split('@')[1] || 'not configured'}`);
  console.log(`   WebSockets  : ${SOCKETS_ENABLED ? 'Attached' : 'Disabled (separate chat service)'}`);
  console.log(`   Workers     : ${WORKERS_ENABLED ? 'In process' : 'Disabled (separate worker service)'}\n`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────
// Closing Socket.io also closes the HTTP server.
onShutdown([
  () => (SOCKETS_ENABLED ? closeSocket() : new Promise((resolve) => server.close(() => resolve()))),
  stopWorkers,
  closeDatabase,
  closeRedis,
]);

module.exports = server; // for testing
