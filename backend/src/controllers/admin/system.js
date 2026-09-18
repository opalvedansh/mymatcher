const fs = require('fs');
const path = require('path');
const db = require('../../config/db');
const redisClient = require('../../config/redis');
const { healthBody } = require('../../lifecycle');
const { getQueueStats } = require('../../config/queue');

/**
 * Every probe is wrapped. A health endpoint that 500s when a dependency is
 * unhealthy is useless exactly when you need it, so one broken thing reports
 * { ok: false, error } and the rest of the page still renders.
 */
async function probe(fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true, latency_ms: Date.now() - started, ...value };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - started, error: err.message };
  }
}

async function getSystem(req, res, next) {
  try {
    const build = healthBody('api');

    const [database, redis, queues, migrations] = await Promise.all([
      probe(async () => {
        await db.query('SELECT 1');
        return {
          pool: {
            total: db.pool.totalCount,
            idle: db.pool.idleCount,
            // Sustained waiting > 0 is the best early warning that
            // PG_POOL_MAX is too low for the number of instances running.
            waiting: db.pool.waitingCount,
            max: Number(process.env.PG_POOL_MAX) || 20,
          },
        };
      }),

      probe(async () => {
        if (!redisClient) return { configured: false, status: 'not configured' };
        const status = redisClient.status;
        if (status !== 'ready') return { configured: true, status };
        await redisClient.ping();
        return { configured: true, status };
      }),

      probe(() => getQueueStats()),

      probe(async () => {
        const { rows } = await db.query(
          'SELECT filename, applied_at FROM _migrations ORDER BY filename DESC LIMIT 1'
        );
        const { rows: [count] } = await db.query('SELECT count(*)::int AS applied FROM _migrations');

        // Comparing the newest applied row against the newest file on disk
        // tells you instantly whether this deploy's migrations actually ran.
        let latestOnDisk = null;
        try {
          const dir = path.join(__dirname, '../../../migrations');
          latestOnDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().pop() ?? null;
        } catch {
          latestOnDisk = null;
        }

        return {
          latest_applied: rows[0]?.filename ?? null,
          applied_at: rows[0]?.applied_at ?? null,
          applied_count: count.applied,
          latest_on_disk: latestOnDisk,
          up_to_date: latestOnDisk ? rows[0]?.filename === latestOnDisk : null,
        };
      }),
    ]);

    // Deliberately derived status only. No process.env, no connection string,
    // no key material — this response is the easiest thing in the whole panel
    // to accidentally paste into a support thread.
    res.json({
      build: {
        commit: build.commit,
        started_at: build.startedAt,
        uptime_s: Math.round(process.uptime()),
        node_env: process.env.NODE_ENV || 'development',
        node_version: process.version,
        service: 'api',
        sockets_enabled: process.env.ENABLE_SOCKETS !== 'false',
        workers_enabled: process.env.RUN_WORKERS !== 'false',
      },
      database,
      redis,
      queues,
      migrations,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/openapi.json ─────────────────────────────────
//
// /api-docs is no longer public in production; the spec lives here instead so
// the panel and anyone holding an admin token still have it.
function getOpenApiSpec(req, res) {
  req.audit.skip();
  res.json(require('../../config/swagger'));
}

module.exports = { getSystem, getOpenApiSpec };
