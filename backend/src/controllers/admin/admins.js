const db = require('../../config/db');
const logger = require('../../config/logger');
const requireAdmin = require('../../middleware/requireAdmin');
const { getSupabaseAdmin } = require('../../config/supabaseAdmin');
const { startCsv, writeRows } = require('../../utils/csv');

const { ROLES, ROLE_PERMISSIONS, PERMISSIONS, expandPermissions, invalidateAdmin } = requireAdmin;

function invalid(message, code) {
  const err = new Error(message);
  err.statusCode = 422;
  err.expose = true;
  if (code) err.code = code;
  return err;
}

// ─── GET /api/admin/me ───────────────────────────────────────────
//
// The panel calls this on boot to decide which nav items to render. It
// returns the permission *list*, not just the role, so the frontend never
// hardcodes the role→permission mapping and can never drift from the server's.
async function getMe(req, res) {
  req.audit.skip();
  res.json({
    id: req.admin.id,
    email: req.admin.email || req.user.email,
    role: req.admin.role,
    permissions: expandPermissions(req.admin.role),
    all_permissions: PERMISSIONS,
    roles: ROLES.map((role) => ({ role, permissions: expandPermissions(role) })),
  });
}

// ─── GET /api/admin/admins ───────────────────────────────────────
async function listAdmins(req, res, next) {
  try {
    const includeRevoked = req.query.include_revoked === 'true';
    const { rows } = await db.query(
      `SELECT a.user_id, a.email, a.role, a.note, a.created_by, a.created_at,
              a.revoked_at, a.revoked_by,
              (SELECT max(created_at) FROM admin_audit_log l WHERE l.admin_id = a.user_id) AS last_action_at
         FROM admin_users a
        ${includeRevoked ? '' : 'WHERE a.revoked_at IS NULL'}
        ORDER BY a.revoked_at NULLS FIRST, a.created_at DESC`
    );
    res.json({ data: rows.map((r) => ({ ...r, permissions: expandPermissions(r.role) })) });
  } catch (err) {
    next(err);
  }
}

/**
 * Resolves an email to a Supabase uid: the users table first (one indexed
 * lookup for anyone who has opened the app), then the auth directory for
 * staff who never have.
 */
async function resolveUserId({ user_id: userId, email }) {
  if (userId) return { userId, email: email || null };
  if (!email) throw invalid('Either user_id or email is required');

  const { rows } = await db.query('SELECT id, email FROM users WHERE lower(email) = lower($1)', [email]);
  if (rows.length) return { userId: rows[0].id, email: rows[0].email };

  const admin = getSupabaseAdmin();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return { userId: found.id, email: found.email };
    if (data.users.length < 1000) break;
  }

  // No invite-token flow on purpose: Supabase already owns identity, and a
  // second one would be a second thing to secure.
  throw invalid(
    `No Supabase account for ${email}. They must sign up first, then you can grant access.`,
    'no_auth_account'
  );
}

// ─── POST /api/admin/admins ──────────────────────────────────────
async function grantAdmin(req, res, next) {
  try {
    const { role, note } = req.body;
    if (!ROLES.includes(role)) throw invalid(`role must be one of ${ROLES.join(', ')}`);

    const { userId, email } = await resolveUserId(req.body);

    const { rows: [row] } = await db.query(
      `INSERT INTO admin_users (user_id, email, role, note, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET role = EXCLUDED.role, note = EXCLUDED.note, email = COALESCE(EXCLUDED.email, admin_users.email),
             revoked_at = NULL, revoked_by = NULL
       RETURNING *`,
      [userId, email, role, note ?? null, req.admin.id]
    );

    await invalidateAdmin(userId);
    req.audit.set({ action: 'admin.grant', targetType: 'admin', targetId: userId })
      .add({ role, email });

    logger.warn({ admin: req.admin.id, granted: userId, role }, 'Admin access granted');
    res.status(201).json({ ...row, permissions: expandPermissions(row.role) });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/admin/admins/:userId ─────────────────────────────
async function updateAdmin(req, res, next) {
  const { userId } = req.params;
  const { role, note } = req.body;

  if (role && !ROLES.includes(role)) return next(invalid(`role must be one of ${ROLES.join(', ')}`));
  // Prevents the "locked everyone out at 2am" incident.
  if (userId === req.admin.id && role && role !== req.admin.role) {
    return next(invalid('You cannot change your own role. Ask another superadmin.'));
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query(
      'SELECT * FROM admin_users WHERE user_id = $1 FOR UPDATE', [userId]
    );
    if (!before) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (role && before.role === 'superadmin' && role !== 'superadmin') {
      await assertNotLastSuperadmin(client, userId);
    }

    const { rows: [after] } = await client.query(
      `UPDATE admin_users SET role = COALESCE($2, role), note = COALESCE($3, note)
        WHERE user_id = $1 RETURNING *`,
      [userId, role ?? null, note ?? null]
    );
    await client.query('COMMIT');

    await invalidateAdmin(userId);
    req.audit.set({ action: 'admin.update', targetType: 'admin', targetId: userId, reason: req.body.reason })
      .snapshot({ role: before.role, note: before.note }, { role: after.role, note: after.note });

    res.json({ ...after, permissions: expandPermissions(after.role) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// ─── DELETE /api/admin/admins/:userId ────────────────────────────
async function revokeAdmin(req, res, next) {
  const { userId } = req.params;
  if (userId === req.admin.id) {
    return next(invalid('You cannot revoke your own access. Ask another superadmin.'));
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query(
      'SELECT * FROM admin_users WHERE user_id = $1 AND revoked_at IS NULL FOR UPDATE', [userId]
    );
    if (!before) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Admin not found or already revoked' });
    }

    if (before.role === 'superadmin') await assertNotLastSuperadmin(client, userId);

    const { rows: [after] } = await client.query(
      'UPDATE admin_users SET revoked_at = now(), revoked_by = $2 WHERE user_id = $1 RETURNING *',
      [userId, req.admin.id]
    );
    await client.query('COMMIT');

    await invalidateAdmin(userId);
    req.audit.set({ action: 'admin.revoke', targetType: 'admin', targetId: userId, reason: req.body.reason })
      .add({ role: before.role });

    logger.warn({ admin: req.admin.id, revoked: userId }, 'Admin access revoked');
    res.json({ user_id: userId, revoked_at: after.revoked_at });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/**
 * Checked inside the caller's transaction, not before it: two concurrent
 * revocations that each saw a count of 2 would otherwise both succeed and
 * leave nobody able to grant access back.
 */
async function assertNotLastSuperadmin(client, excludingUserId) {
  const { rows: [row] } = await client.query(
    `SELECT count(*)::int AS remaining FROM admin_users
      WHERE role = 'superadmin' AND revoked_at IS NULL AND user_id <> $1`,
    [excludingUserId]
  );
  if (row.remaining < 1) {
    throw invalid('This is the last superadmin. Grant the role to someone else first.');
  }
}

// ─── GET /api/admin/audit ────────────────────────────────────────
function buildAuditFilter(query) {
  const where = [];
  const params = [];
  const add = (v) => `$${params.push(v)}`;

  if (query.admin_id) where.push(`l.admin_id = ${add(query.admin_id)}`);
  if (query.action) where.push(`l.action = ${add(query.action)}`);
  if (query.target_type) where.push(`l.target_type = ${add(query.target_type)}`);
  if (query.target_id) where.push(`l.target_id = ${add(query.target_id)}`);
  if (query.status) where.push(`l.status = ${add(Number(query.status))}`);
  if (query.from) where.push(`l.created_at >= ${add(query.from)}::date`);
  if (query.to) where.push(`l.created_at < (${add(query.to)}::date + 1)`);
  if (query.search) where.push(`l.reason ILIKE ${add(`%${String(query.search).replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`);

  return { where, params };
}

async function listAudit(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { where, params } = buildAuditFilter(req.query);

    // Keyset on the BIGSERIAL alone: it is monotonic, unique and already the
    // leading column of idx_audit_created, so no composite cursor is needed.
    if (req.query.cursor) {
      const id = Number(req.query.cursor);
      if (!Number.isFinite(id)) return next(invalid('Malformed cursor'));
      where.push(`l.id < $${params.push(id)}`);
    }

    const { rows } = await db.query(
      `SELECT l.id, l.admin_id, l.admin_email, l.action, l.target_type, l.target_id,
              l.reason, l.metadata, host(l.ip) AS ip, l.user_agent, l.status, l.created_at,
              a.role AS admin_role
         FROM admin_audit_log l
         LEFT JOIN admin_users a ON a.user_id = l.admin_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({ data, next_cursor: hasMore ? String(data[data.length - 1].id) : null });
  } catch (err) {
    next(err);
  }
}

const AUDIT_CSV_COLUMNS = [
  'id', 'created_at', 'admin_id', 'admin_email', 'action',
  'target_type', 'target_id', 'reason', 'status', 'ip',
];

async function exportAudit(req, res, next) {
  try {
    const { where, params } = buildAuditFilter(req.query);
    req.audit.set({ action: 'audit.export', force: true }).add({ filters: req.query });

    startCsv(res, `matchr-audit-${new Date().toISOString().slice(0, 10)}.csv`, AUDIT_CSV_COLUMNS);

    let lastId = null;
    let total = 0;
    for (let page = 0; page < 1000; page++) {
      const pageParams = [...params];
      const pageWhere = [...where];
      if (lastId !== null) pageWhere.push(`l.id < $${pageParams.push(lastId)}`);

      const { rows } = await db.query(
        `SELECT l.id, l.created_at, l.admin_id, l.admin_email, l.action,
                l.target_type, l.target_id, l.reason, l.status, host(l.ip) AS ip
           FROM admin_audit_log l
          ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
          ORDER BY l.id DESC LIMIT $${pageParams.push(1000)}`,
        pageParams
      );
      if (!rows.length) break;

      writeRows(res, rows, (r) => AUDIT_CSV_COLUMNS.map((c) => r[c]));
      total += rows.length;
      lastId = rows[rows.length - 1].id;
      if (rows.length < 1000) break;
    }

    req.audit.add({ rows: total });
    res.end();
  } catch (err) {
    if (res.headersSent) {
      logger.error({ err: err.message }, '[admin] audit export failed mid-stream');
      return res.end();
    }
    next(err);
  }
}

module.exports = {
  getMe,
  listAdmins,
  grantAdmin,
  updateAdmin,
  revokeAdmin,
  listAudit,
  exportAudit,
  resolveUserId,
  ROLE_PERMISSIONS,
};
