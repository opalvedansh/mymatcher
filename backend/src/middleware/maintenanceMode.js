const logger = require('../config/logger');

/**
 * Returns 503 to non-admin traffic while maintenance mode is on.
 *
 * The flag is held in a module-level variable refreshed by a background
 * poller, and the middleware reads it synchronously. Deliberately not a
 * per-request cache lookup: this runs in front of every API call, and a
 * feature used a handful of times a year must not put an await — let alone a
 * query — on the hot path.
 *
 * The cost is latency, not correctness: turning maintenance on takes effect
 * within REFRESH_MS. Turning it on through PUT /api/admin/settings also calls
 * refresh() directly, so the instance the operator talked to switches at once
 * and the others follow on their next tick.
 *
 * Fails open. A DB or cache error leaves the flag at its last known value
 * (default: off), because a blip in reading a rarely-used switch must never
 * be the thing that takes the API down.
 */

// /health so Railway's probe keeps passing, /api/admin so the panel can turn
// maintenance back off, /admin so the panel itself still loads, and /api/auth
// so the app can resolve its session and show a maintenance screen to a
// signed-in user rather than bouncing them to login.
const EXEMPT = [/^\/health$/, /^\/api\/admin(\/|$)/, /^\/api\/auth(\/|$)/, /^\/admin(\/|$)/];

const REFRESH_MS = 30_000;
const DEFAULT_MODE = { enabled: false, message: 'Matchr is down for maintenance. Back shortly.', allow_admins: true };

let current = DEFAULT_MODE;
let timer = null;

async function refresh() {
  try {
    const { getSetting } = require('../services/adminSettings');
    const value = await getSetting('maintenance_mode', DEFAULT_MODE);
    if (value && typeof value.enabled === 'boolean') current = value;
  } catch (err) {
    logger.warn({ err: err.message }, '[maintenance] refresh failed, keeping last known state');
  }
  return current;
}

/**
 * Started from server.listen, not at import. Skipped under test for the same
 * reason Redis, BullMQ and the rate-limit store are: tests mock db.query with
 * a positional queue, and a background query would consume from it at
 * unpredictable moments.
 */
function startMaintenancePoller() {
  if (timer || process.env.NODE_ENV === 'test') return;
  refresh().catch(() => {});
  timer = setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
  timer.unref();
}

function stopMaintenancePoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

function maintenanceMode(req, res, next) {
  if (!current.enabled) return next();
  if (EXEMPT.some((re) => re.test(req.path))) return next();

  res.set('Retry-After', '300');
  return res.status(503).json({
    error: current.message || DEFAULT_MODE.message,
    code: 'maintenance',
  });
}

maintenanceMode.refresh = refresh;
maintenanceMode.start = startMaintenancePoller;
maintenanceMode.stop = stopMaintenancePoller;
maintenanceMode.EXEMPT = EXEMPT;
// Test seam: lets a test set the flag without a timer or a DB round trip.
maintenanceMode._set = (mode) => { current = { ...DEFAULT_MODE, ...mode }; };

module.exports = maintenanceMode;
