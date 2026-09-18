const db = require('../../config/db');
const logger = require('../../config/logger');
const { endSessions } = require('../../utils/sessions');
const { invalidateCache } = require('../../middleware/cacheMiddleware');
const { recordFromRequest, diffOnly } = require('../../services/adminAudit');
const userDeletion = require('../../services/userDeletion');
const feedDeck = require('../../services/feedDeck');
const { startCsv, writeRows } = require('../../utils/csv');
const {
  escapeLike, encodeCursor, decodeCursor, clampLimit, boolParam,
} = require('../../utils/adminQuery');

const MAX_OFFSET = 10_000;
const BULK_MAX = 500;
const BULK_CHUNK = 500;

function invalid(message) {
  const err = new Error(message);
  err.statusCode = 422;
  err.expose = true;
  return err;
}

/**
 * Builds the shared WHERE clause for the user list, the count and the CSV
 * export, so a filter can never mean one thing on screen and another in the
 * file an operator downloads.
 */
function buildUserFilter(query) {
  const where = [];
  const params = [];
  const add = (value) => `$${params.push(value)}`;

  if (!boolParam(query.include_deleted)) where.push('u.deleted_at IS NULL');

  if (query.role) {
    if (!['brand', 'influencer'].includes(query.role)) throw invalid('role must be brand or influencer');
    where.push(`u.role = ${add(query.role)}::user_role`);
  }

  const banned = boolParam(query.banned);
  if (banned !== undefined) where.push(`u.banned = ${add(banned)}`);

  const verified = boolParam(query.verified);
  if (verified !== undefined) where.push(`COALESCE(bp.verified, ip.verified, false) = ${add(verified)}`);

  if (query.verification_status) {
    const allowed = ['none', 'pending', 'approved', 'rejected'];
    if (!allowed.includes(query.verification_status)) {
      throw invalid(`verification_status must be one of ${allowed.join(', ')}`);
    }
    where.push(`bp.verification_status = ${add(query.verification_status)}`);
  }

  const hasPush = boolParam(query.has_push_token);
  if (hasPush === true) where.push('u.expo_push_token IS NOT NULL');
  if (hasPush === false) where.push('u.expo_push_token IS NULL');

  const hasMatches = boolParam(query.has_matches);
  if (hasMatches !== undefined) {
    // Two EXISTS rather than an OR across columns: each uses its own index.
    const clause = `(EXISTS (SELECT 1 FROM matches m WHERE m.brand_id = u.id)
                  OR EXISTS (SELECT 1 FROM matches m WHERE m.influencer_id = u.id))`;
    where.push(hasMatches ? clause : `NOT ${clause}`);
  }

  if (query.created_from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.created_from)) throw invalid('created_from must be YYYY-MM-DD');
    where.push(`u.created_at >= ${add(query.created_from)}::date`);
  }
  if (query.created_to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.created_to)) throw invalid('created_to must be YYYY-MM-DD');
    where.push(`u.created_at < (${add(query.created_to)}::date + 1)`);
  }

  if (query.search) {
    const term = String(query.search).trim();
    // Below two characters the pg_trgm GIN indexes from 010 cannot be used and
    // this degrades to a sequential scan of three tables.
    if (term.length < 2) throw invalid('search needs at least 2 characters');
    const p = add(`%${escapeLike(term)}%`);
    where.push(`(u.email ILIKE ${p} OR bp.name ILIKE ${p} OR ip.name ILIKE ${p} OR u.id = ${add(term)})`);
  }

  return { where, params };
}

const USER_FROM = `
  FROM users u
  LEFT JOIN brand_profiles      bp ON bp.user_id = u.id
  LEFT JOIN influencer_profiles ip ON ip.user_id = u.id`;

const USER_COLUMNS = `
  u.id, u.email, u.role, u.banned, u.banned_at, u.banned_reason, u.deleted_at,
  u.created_at, (u.expo_push_token IS NOT NULL) AS has_push_token,
  COALESCE(bp.name, ip.name)                    AS name,
  COALESCE(bp.logo_url, ip.avatar_url)          AS avatar_url,
  COALESCE(bp.verified, ip.verified, false)     AS verified,
  bp.verification_status`;

// Sortable columns are a fixed map, never interpolated from the query string.
const SORTS = {
  created_at: 'u.created_at',
  name: 'COALESCE(bp.name, ip.name)',
  followers: 'ip.followers',
  matches: 'match_count',
};

// ─── GET /api/admin/users ────────────────────────────────────────
async function listUsers(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 50, 100);
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const sort = req.query.sort || 'created_at';
    if (!SORTS[sort]) throw invalid(`sort must be one of ${Object.keys(SORTS).join(', ')}`);

    const { where, params } = buildUserFilter(req.query);

    const matchCount = `(
      (SELECT count(*) FROM matches m WHERE m.brand_id = u.id)
    + (SELECT count(*) FROM matches m WHERE m.influencer_id = u.id))::int AS match_count`;

    // Keyset only works for the default sort, where (created_at, id) is unique
    // and indexed. For the others, fall back to OFFSET and say so, rather than
    // pretending a cursor is correct and silently skipping rows.
    const useKeyset = sort === 'created_at';
    let pagination = 'keyset';
    let tail;

    if (useKeyset) {
      const cursor = decodeCursor(req.query.cursor);
      if (req.query.cursor && !cursor) throw invalid('Malformed cursor');
      if (cursor) {
        const op = dir === 'DESC' ? '<' : '>';
        where.push(`(u.created_at, u.id) ${op} ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)}::text)`);
      }
      tail = `ORDER BY u.created_at ${dir}, u.id ${dir} LIMIT $${params.push(limit + 1)}`;
    } else {
      pagination = 'offset';
      const offset = parseInt(req.query.offset, 10) || 0;
      if (offset < 0 || offset > MAX_OFFSET) throw invalid(`offset must be between 0 and ${MAX_OFFSET}`);
      tail = `ORDER BY ${SORTS[sort]} ${dir} NULLS LAST, u.id DESC
              LIMIT $${params.push(limit + 1)} OFFSET $${params.push(offset)}`;
    }

    const sql = `SELECT ${USER_COLUMNS}, ${matchCount} ${USER_FROM}
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ${tail}`;

    const { rows } = await db.query(sql, params);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const body = {
      data,
      pagination,
      next_cursor: useKeyset && hasMore
        ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
        : null,
      has_more: hasMore,
    };

    if (boolParam(req.query.count)) body.total = await countUsers(req.query);
    res.json(body);
  } catch (err) {
    next(err);
  }
}

async function countUsers(query) {
  const { where, params } = buildUserFilter(query);
  const { rows: [row] } = await db.query(
    `SELECT count(*)::int AS total ${USER_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params
  );
  return row.total;
}

// ─── GET /api/admin/users/:userId ────────────────────────────────
async function getUser(req, res, next) {
  try {
    const { userId } = req.params;

    const { rows: [user] } = await db.query(
      `SELECT u.id, u.email, u.role, u.banned, u.banned_at, u.banned_by, u.banned_reason,
              u.deleted_at, u.created_at, u.updated_at,
              (u.expo_push_token IS NOT NULL) AS has_push_token,
              a.role AS admin_role
         FROM users u
         LEFT JOIN admin_users a ON a.user_id = u.id AND a.revoked_at IS NULL
        WHERE u.id = $1`,
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // location_geog is a PostGIS binary column and exact coordinates are
    // deliberately not exposed anywhere else; onboarding_data is a free-form
    // client-written bucket with its own audited route.
    const profileTable = user.role === 'brand' ? 'brand_profiles' : 'influencer_profiles';
    const profilePromise = user.role
      ? db.query(`SELECT * FROM ${profileTable} WHERE user_id = $1`, [userId])
      : Promise.resolve({ rows: [] });

    const [
      profileRes, countsRes, swipesRes, matchesRes, filedRes, againstRes, ratingsRes, actionsRes,
    ] = await Promise.all([
      profilePromise,
      db.query(
        `SELECT
           (SELECT count(*) FROM swipes  WHERE swiper_id = $1)::int                                   AS swipes_sent,
           (SELECT count(*) FROM swipes  WHERE swiped_id = $1)::int                                   AS swipes_received,
           (SELECT count(*) FROM swipes  WHERE swiper_id = $1 AND direction <> 'reject')::int         AS likes_sent,
           (SELECT count(*) FROM swipes  WHERE swiped_id = $1 AND direction <> 'reject')::int         AS likes_received,
           (SELECT count(*) FROM matches WHERE (brand_id = $1 OR influencer_id = $1) AND status = 'active')::int   AS matches_active,
           (SELECT count(*) FROM matches WHERE (brand_id = $1 OR influencer_id = $1) AND status = 'archived')::int AS matches_archived,
           (SELECT count(*) FROM messages WHERE sender_id = $1)::int                                  AS messages_sent,
           (SELECT count(*) FROM posts   WHERE user_id = $1)::int                                     AS posts,
           (SELECT count(*) FROM stories WHERE user_id = $1)::int                                     AS stories,
           (SELECT count(*) FROM reports WHERE reporter_id = $1)::int                                 AS reports_filed,
           (SELECT count(*) FROM reports WHERE target_type = 'user' AND target_id = $1)::int          AS reports_against,
           (SELECT count(*) FROM user_blocks WHERE blocker_id = $1)::int                              AS blocks_made,
           (SELECT count(*) FROM user_blocks WHERE blocked_id = $1)::int                              AS blocks_received,
           (SELECT count(*) FROM brand_ratings WHERE brand_id = $1)::int                              AS ratings_received,
           (SELECT ROUND(AVG(score)::numeric, 2) FROM brand_ratings WHERE brand_id = $1)              AS rating_avg`,
        [userId]
      ),
      db.query(
        `SELECT s.swiped_id, s.direction, s.created_at,
                COALESCE(bp.name, ip.name) AS target_name
           FROM swipes s
           LEFT JOIN brand_profiles      bp ON bp.user_id = s.swiped_id
           LEFT JOIN influencer_profiles ip ON ip.user_id = s.swiped_id
          WHERE s.swiper_id = $1 ORDER BY s.created_at DESC LIMIT 10`,
        [userId]
      ),
      db.query(
        `SELECT m.id, m.brand_id, m.influencer_id, m.status, m.matched_at,
                COALESCE(bp.name, ip.name) AS other_name
           FROM matches m
           LEFT JOIN brand_profiles      bp ON bp.user_id = m.brand_id      AND m.brand_id <> $1
           LEFT JOIN influencer_profiles ip ON ip.user_id = m.influencer_id AND m.influencer_id <> $1
          WHERE m.brand_id = $1 OR m.influencer_id = $1
          ORDER BY m.matched_at DESC LIMIT 10`,
        [userId]
      ),
      db.query(
        `SELECT id, target_type, target_id, reason, status, created_at
           FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [userId]
      ),
      db.query(
        `SELECT id, reporter_id, reason, details, status, created_at
           FROM reports WHERE target_type = 'user' AND target_id = $1
          ORDER BY created_at DESC LIMIT 10`,
        [userId]
      ),
      db.query(
        `SELECT r.id, r.influencer_id, r.score, r.created_at, ip.name AS rater_name
           FROM brand_ratings r
           LEFT JOIN influencer_profiles ip ON ip.user_id = r.influencer_id
          WHERE r.brand_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
        [userId]
      ),
      // "What has this team already done to this person" — one indexed query
      // (idx_audit_target) and the most useful thing on a support screen.
      db.query(
        `SELECT id, admin_id, admin_email, action, reason, status, created_at
           FROM admin_audit_log
          WHERE target_type = 'user' AND target_id = $1
          ORDER BY created_at DESC LIMIT 20`,
        [userId]
      ),
    ]);

    const profile = profileRes.rows[0] ? { ...profileRes.rows[0] } : null;
    if (profile) delete profile.location_geog;

    res.json({
      user,
      profile,
      counts: countsRes.rows[0],
      recent: {
        swipes: swipesRes.rows,
        matches: matchesRes.rows,
        reports_filed: filedRes.rows,
        reports_against: againstRes.rows,
        ratings: ratingsRes.rows,
        admin_actions: actionsRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/users/:userId/onboarding ─────────────────────
//
// Separate and audited: onboarding_data is a free-form JSONB draft bucket the
// client writes into, so it can hold anything a user typed and abandoned.
async function getUserOnboarding(req, res, next) {
  try {
    req.audit.set({ action: 'user.onboarding_read', targetType: 'user', targetId: req.params.userId, force: true });
    const { rows: [row] } = await db.query(
      'SELECT onboarding_data FROM users WHERE id = $1',
      [req.params.userId]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ onboarding_data: row.onboarding_data });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/admin/users/:userId ──────────────────────────────
//
// Only fields an operator has a legitimate reason to correct. `verified`,
// `followers`, `engagement_rate` and `avg_views` are excluded on purpose: they
// are measurements produced by Instagram sync and face verification, and the
// product deliberately hides unmeasured audience numbers rather than showing
// a typed-in one as if it were a fact.
const EDITABLE = {
  brand: ['name', 'bio', 'website', 'location', 'categories', 'budget_min', 'budget_max', 'campaign_days'],
  influencer: ['name', 'bio', 'location', 'categories', 'price_min', 'price_max', 'age', 'gender'],
};

async function updateUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { rows: [user] } = await db.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.role) return res.status(422).json({ error: 'User has not chosen a role yet' });

    const table = user.role === 'brand' ? 'brand_profiles' : 'influencer_profiles';
    const allowed = EDITABLE[user.role];
    const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
    if (!fields.length) {
      return res.status(422).json({ error: `No editable fields. Allowed: ${allowed.join(', ')}` });
    }

    const { rows: [before] } = await db.query(`SELECT * FROM ${table} WHERE user_id = $1`, [userId]);
    if (!before) return res.status(404).json({ error: 'Profile not found' });

    const params = [userId];
    const sets = fields.map((f) => `${f} = $${params.push(req.body[f])}`);
    const { rows: [after] } = await db.query(
      `UPDATE ${table} SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1 RETURNING *`,
      params
    );

    delete before.location_geog;
    delete after.location_geog;

    req.audit
      .set({ action: 'user.profile_update', targetType: 'user', targetId: userId })
      .snapshot(diffOnly(before, after), null);

    await afterUserChange(userId);
    res.json({ user, profile: after });
  } catch (err) {
    next(err);
  }
}

/**
 * Everything that must be invalidated when a user's visibility changes.
 *
 * Note what this does NOT have to do: purge this user from other people's
 * cached decks. A deck stores ids, and every page is hydrated by re-running
 * the ranking query restricted to them (feedDeck.js:9-13), so the
 * `u.banned = false` predicate drops a banned card even from a deck built
 * before the ban. This call clears the banned user's own deck.
 */
async function afterUserChange(userId) {
  await invalidateCache(`cache:/api/profiles/${userId}`);
  try {
    await feedDeck.invalidate(userId);
  } catch (err) {
    logger.warn({ err: err.message, userId }, '[admin] deck invalidation failed');
  }
}

// ─── POST /api/admin/users/:userId/ban ───────────────────────────
async function banUser(req, res, next) {
  try {
    const { userId } = req.params;
    const reason = req.body.reason;
    const { rows: [row] } = await db.query(
      `UPDATE users
          SET banned = true, banned_at = now(), banned_by = $2, banned_reason = $3, updated_at = now()
        WHERE id = $1
        RETURNING id, banned, banned_at, banned_reason`,
      [userId, req.admin.id, reason]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });

    await endSessions([userId]);
    await afterUserChange(userId);

    req.audit.set({ action: 'user.ban', targetType: 'user', targetId: userId, reason });
    logger.warn({ userId, admin: req.admin.id, reason }, 'User banned by admin');
    res.json(row);
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/users/:userId/unban ─────────────────────────
async function unbanUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { rows: [row] } = await db.query(
      `UPDATE users
          SET banned = false, banned_at = NULL, banned_by = NULL, banned_reason = NULL, updated_at = now()
        WHERE id = $1
        RETURNING id, banned`,
      [userId]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });

    // No disconnect: there is nothing to kick, and the cached session that
    // still says "banned" is what needs clearing.
    await endSessions([userId], { disconnect: false });
    await afterUserChange(userId);

    req.audit.set({ action: 'user.unban', targetType: 'user', targetId: userId });
    logger.info({ userId, admin: req.admin.id }, 'User unbanned by admin');
    res.json(row);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/admin/users/:userId ─────────────────────────────
async function deleteUser(req, res, next) {
  try {
    const { userId } = req.params;
    const hard = req.query.hard === 'true';
    const reason = req.body.reason;

    if (hard && !req.admin.permissions.includes('*') && !req.admin.permissions.includes('users:delete')) {
      return res.status(403).json({
        error: 'Insufficient admin permission',
        required_permission: 'users:delete',
        your_role: req.admin.role,
      });
    }

    if (hard) {
      // Written before the action, not after: a hard delete is irreversible
      // and the record of who ordered it must survive a crash mid-handler.
      const row = await recordFromRequest(req, {
        action: 'user.hard_delete', targetType: 'user', targetId: userId, reason,
      });
      req.audit.rowId = row.id;

      const { deleted } = await userDeletion.hardDeleteUser(userId, { actorId: req.admin.id, reason });
      if (!deleted) return res.status(404).json({ error: 'User not found' });
      await afterUserChange(userId);
      return res.json({ deleted: 'hard' });
    }

    const { deleted } = await userDeletion.softDeleteUser(userId, { actorId: req.admin.id, reason });
    if (!deleted) return res.status(404).json({ error: 'User not found or already deleted' });
    await afterUserChange(userId);

    req.audit.set({ action: 'user.soft_delete', targetType: 'user', targetId: userId, reason });
    res.json({ deleted: 'soft' });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/users/:userId/restore ───────────────────────
async function restoreUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { restored } = await userDeletion.restoreUser(userId);
    if (!restored) return res.status(404).json({ error: 'User not found or not deleted' });
    await afterUserChange(userId);
    req.audit.set({ action: 'user.restore', targetType: 'user', targetId: userId });
    res.json({ restored: true });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/users/bulk-ban | bulk-unban ─────────────────
async function bulkSetBanned(req, res, next, banned) {
  try {
    const userIds = [...new Set(req.body.userIds)];
    if (userIds.length > BULK_MAX) throw invalid(`At most ${BULK_MAX} users per request`);

    let affected = 0;
    const touched = [];
    for (let i = 0; i < userIds.length; i += BULK_CHUNK) {
      const chunk = userIds.slice(i, i + BULK_CHUNK);
      const { rows } = await db.query(
        banned
          ? `UPDATE users SET banned = true, banned_at = now(), banned_by = $2, banned_reason = $3, updated_at = now()
              WHERE id = ANY($1::text[]) RETURNING id`
          : `UPDATE users SET banned = false, banned_at = NULL, banned_by = NULL, banned_reason = NULL, updated_at = now()
              WHERE id = ANY($1::text[]) RETURNING id`,
        banned ? [chunk, req.admin.id, req.body.reason] : [chunk]
      );
      affected += rows.length;
      touched.push(...rows.map((r) => r.id));
      await endSessions(chunk, { disconnect: banned });
    }

    await Promise.all(touched.map((id) => invalidateCache(`cache:/api/profiles/${id}`)));

    req.audit
      .set({
        action: banned ? 'user.bulk_ban' : 'user.bulk_unban',
        targetType: 'user',
        reason: req.body.reason,
      })
      .add({ requested: userIds.length, affected, user_ids: touched });

    logger.warn({ admin: req.admin.id, affected, banned }, 'Bulk ban state applied');
    res.json({
      affected,
      missing: userIds.filter((id) => !touched.includes(id)),
    });
  } catch (err) {
    next(err);
  }
}

const bulkBanUsers = (req, res, next) => bulkSetBanned(req, res, next, true);
const bulkUnbanUsers = (req, res, next) => bulkSetBanned(req, res, next, false);

// ─── GET /api/admin/users/export.csv ─────────────────────────────
const CSV_COLUMNS = [
  'id', 'email', 'name', 'role', 'banned', 'banned_reason', 'verified',
  'verification_status', 'deleted_at', 'created_at', 'match_count', 'has_push_token',
];

async function exportUsers(req, res, next) {
  try {
    const { where, params } = buildUserFilter(req.query);
    req.audit.set({ action: 'user.export', force: true }).add({ filters: req.query });

    startCsv(res, `matchr-users-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS);

    // Keyset pages, streamed: an export of every user is unbounded by
    // definition, so the whole file must never exist in memory at once.
    let cursor = null;
    let total = 0;
    for (let page = 0; page < 1000; page++) {
      const pageParams = [...params];
      const pageWhere = [...where];
      if (cursor) {
        pageWhere.push(`(u.created_at, u.id) < ($${pageParams.push(cursor.ts)}::timestamptz, $${pageParams.push(cursor.id)}::text)`);
      }
      const { rows } = await db.query(
        `SELECT ${USER_COLUMNS},
                ((SELECT count(*) FROM matches m WHERE m.brand_id = u.id)
               + (SELECT count(*) FROM matches m WHERE m.influencer_id = u.id))::int AS match_count
         ${USER_FROM}
         ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT $${pageParams.push(1000)}`,
        pageParams
      );
      if (!rows.length) break;

      writeRows(res, rows, (r) => CSV_COLUMNS.map((c) => r[c]));
      total += rows.length;
      const last = rows[rows.length - 1];
      cursor = { ts: last.created_at.toISOString(), id: last.id };
      if (rows.length < 1000) break;
    }

    req.audit.add({ rows: total });
    res.end();
  } catch (err) {
    // Headers are already sent once streaming starts; the client sees a
    // truncated file, and the audit row plus this log are how you find out.
    if (res.headersSent) {
      logger.error({ err: err.message, admin: req.admin?.id }, '[admin] CSV export failed mid-stream');
      return res.end();
    }
    next(err);
  }
}

module.exports = {
  listUsers,
  getUser,
  getUserOnboarding,
  updateUser,
  banUser,
  unbanUser,
  deleteUser,
  restoreUser,
  bulkBanUsers,
  bulkUnbanUsers,
  exportUsers,
  buildUserFilter,
  countUsers,
  SORTS,
};
