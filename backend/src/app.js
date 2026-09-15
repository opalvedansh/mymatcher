require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redisClient  = require('./config/redis');
const http         = require('http');
const pinoHttp     = require('pino-http');
const Sentry       = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');
const swaggerUi    = require('swagger-ui-express');
const swaggerSpec  = require('./config/swagger');
const logger       = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');
const { initSocket } = require('./socket');
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
function getRedisStore(prefix) {
  if (!redisClient || process.env.NODE_ENV === 'test') return undefined;
  return new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix,
  });
}

const authLimiter = rateLimit({
  store: getRedisStore('rl:auth:'),
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 3000 : 30, // Increased for dev
  message: { error: 'Too many auth requests — try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const globalLimiter = rateLimit({
  store: getRedisStore('rl:global:'),
  windowMs: 60 * 1000,       // 1 minute
  max: 200,                  // 200 requests per minute per IP
  message: { error: 'Global rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

const swipeLimiter = rateLimit({
  store: getRedisStore('rl:swipe:'),
  windowMs: 60 * 1000,       // 1 minute
  max: 100,                  // 100 swipes/min per IP
  message: { error: 'Swipe rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
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
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(globalLimiter);

// ─── Health check ────────────────────────────────────────────────
// `commit` reports which build is actually serving traffic. Without it a
// deploy cannot be told apart from a stale one, since auth-gated routes look
// identical from outside until you hold a valid token.
const BUILD_COMMIT = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'unknown';
const STARTED_AT = new Date().toISOString();

app.get('/health', (_req, res) =>
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: BUILD_COMMIT.slice(0, 7),
    startedAt: STARTED_AT,
  })
);

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
const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`\n🚀 Matcherc API running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database    : ${process.env.DATABASE_URL?.split('@')[1] || 'not configured'}`);
  console.log(`   WebSockets  : Attached\n`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed. Closing database and Redis connections...');
    try {
      const db = require('./config/db');
      await db.end(); // close Postgres pool
      if (redisClient) await redisClient.quit(); // close Redis client (if active)
      logger.info('Graceful shutdown completed successfully.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });

  // Force close after 10s if connections hang
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server; // for testing
 
