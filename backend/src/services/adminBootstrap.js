const db = require('../config/db');
const logger = require('../config/logger');
const { record } = require('./adminAudit');

/**
 * Seeds admin_users from ADMIN_USER_IDS the first time each id is seen.
 *
 * This exists so the deploy that ships DB-backed roles preserves today's
 * behaviour byte for byte: whoever is an admin before it are admins after it,
 * with no manual step on Railway. A migration cannot do this — it cannot read
 * env, and hardcoding a production uid into a committed .sql would put a real
 * identity in git forever.
 *
 * INSERT ... DO NOTHING, never an UPDATE: a revoked admin must not come back
 * to life because their uid is still sitting in an env var someone forgot
 * about. Once this has run in production, delete ADMIN_USER_IDS — grants
 * belong in the database, where they are revocable without a redeploy.
 */
async function syncBootstrapAdmins() {
  const ids = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return [];

  const { rows } = await db.query(
    `INSERT INTO admin_users (user_id, email, role, created_by, note)
     SELECT s.id, u.email, 'superadmin', 'bootstrap', 'Seeded from ADMIN_USER_IDS'
       FROM unnest($1::text[]) AS s(id)
       LEFT JOIN users u ON u.id = s.id
     ON CONFLICT (user_id) DO NOTHING
     RETURNING user_id`,
    [ids]
  );

  for (const r of rows) {
    await record({
      adminId: 'system',
      action: 'admin.grant',
      targetType: 'admin',
      targetId: r.user_id,
      reason: 'Bootstrapped from ADMIN_USER_IDS',
      metadata: { role: 'superadmin' },
    });
  }

  if (rows.length) {
    logger.warn(
      { seeded: rows.map((r) => r.user_id) },
      'Seeded admin_users from ADMIN_USER_IDS — remove that env var now; grants live in the DB'
    );
  }
  return rows;
}

module.exports = { syncBootstrapAdmins };
