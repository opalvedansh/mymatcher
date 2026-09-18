const db = require('../../config/db');
const logger = require('../../config/logger');
const { endSessions } = require('../../utils/sessions');
const { invalidateCache } = require('../../middleware/cacheMiddleware');
const { recordFromRequest } = require('../../services/adminAudit');
const { decrypt } = require('../../utils/encryption');
const { onlyUuids, encodeCursor, decodeCursor, clampLimit } = require('../../utils/adminQuery');

const CONTEXT_WINDOW = 5;
const BULK_MAX = 100;

function invalid(message) {
  const err = new Error(message);
  err.statusCode = 422;
  err.expose = true;
  return err;
}

/**
 * Resolves the reported content for a page of reports.
 *
 * Groups by target_type into at most four queries, and filters ids to real
 * UUIDs first: reports.target_id is TEXT while post/story/message ids are
 * UUID, so one malformed value in `= ANY($1::uuid[])` would fail the whole
 * query with a 22P02 and take the queue page down with it.
 */
async function resolveTargets(reports) {
  const byType = { user: [], post: [], story: [], message: [] };
  for (const r of reports) byType[r.target_type]?.push(r.target_id);

  const [users, posts, stories, messages] = await Promise.all([
    byType.user.length
      ? db.query(
        `SELECT u.id, u.email, u.banned, u.deleted_at, u.created_at,
                COALESCE(bp.name, ip.name)           AS name,
                COALESCE(bp.bio, ip.bio)             AS bio,
                COALESCE(bp.logo_url, ip.avatar_url) AS avatar_url
           FROM users u
           LEFT JOIN brand_profiles      bp ON bp.user_id = u.id
           LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
          WHERE u.id = ANY($1::text[])`,
        [[...new Set(byType.user)]]
      )
      : { rows: [] },
    byType.post.length
      ? db.query(
        `SELECT id, user_id, image_url, caption, likes_count, created_at
           FROM posts WHERE id = ANY($1::uuid[])`,
        [onlyUuids(byType.post)]
      )
      : { rows: [] },
    byType.story.length
      ? db.query(
        // Stories are never deleted, only filtered by expires_at, so a
        // reported story stays reviewable after it has stopped being shown.
        `SELECT id, user_id, media_url, created_at, expires_at,
                (expires_at < now()) AS expired
           FROM stories WHERE id = ANY($1::uuid[])`,
        [onlyUuids(byType.story)]
      )
      : { rows: [] },
    byType.message.length
      ? db.query(
        // No content. A message's plaintext is only ever served by
        // getMessageContext, which audits before it decrypts.
        `SELECT id, match_id, sender_id, created_at, length(content) AS cipher_length
           FROM messages WHERE id = ANY($1::uuid[])`,
        [onlyUuids(byType.message)]
      )
      : { rows: [] },
  ]);

  const index = {
    user: new Map(users.rows.map((r) => [String(r.id), r])),
    post: new Map(posts.rows.map((r) => [String(r.id), r])),
    story: new Map(stories.rows.map((r) => [String(r.id), r])),
    message: new Map(messages.rows.map((r) => [String(r.id), { ...r, content: null, content_available: true }])),
  };

  // A missing row means the content is already gone. Say so rather than
  // returning null, so the queue shows "already removed" and not an empty card.
  return (report) => index[report.target_type]?.get(String(report.target_id)) ?? { deleted: true };
}

async function attachReporters(reports) {
  const ids = [...new Set(reports.map((r) => r.reporter_id).filter(Boolean))];
  if (!ids.length) return () => null;
  const { rows } = await db.query(
    `SELECT u.id, u.banned, COALESCE(bp.name, ip.name) AS name,
            COALESCE(bp.logo_url, ip.avatar_url) AS avatar_url
       FROM users u
       LEFT JOIN brand_profiles      bp ON bp.user_id = u.id
       LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
      WHERE u.id = ANY($1::text[])`,
    [ids]
  );
  const map = new Map(rows.map((r) => [r.id, r]));
  return (id) => map.get(id) ?? null;
}

// ─── GET /api/admin/reports ──────────────────────────────────────
async function listReports(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 50, 100);
    const where = [];
    const params = [];
    const add = (v) => `$${params.push(v)}`;

    if (req.query.status) where.push(`r.status = ${add(req.query.status)}`);
    if (req.query.target_type) where.push(`r.target_type = ${add(req.query.target_type)}`);
    if (req.query.reason) where.push(`r.reason = ${add(req.query.reason)}`);
    if (req.query.reporter_id) where.push(`r.reporter_id = ${add(req.query.reporter_id)}`);
    if (req.query.target_id) where.push(`r.target_id = ${add(req.query.target_id)}`);

    const cursor = decodeCursor(req.query.cursor);
    if (req.query.cursor && !cursor) throw invalid('Malformed cursor');
    if (cursor) {
      where.push(`(r.created_at, r.id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.details,
              r.status, r.created_at, r.reviewed_at, r.reviewed_by,
              (SELECT count(*) FROM reports o
                WHERE o.target_type = r.target_type AND o.target_id = r.target_id
                  AND o.id <> r.id)::int AS prior_reports_against_target
         FROM reports r
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const [target, reporter] = await Promise.all([resolveTargets(data), attachReporters(data)]);

    res.json({
      data: data.map((r) => ({ ...r, reporter: reporter(r.reporter_id), target: target(r) })),
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/reports/:reportId ────────────────────────────
async function getReport(req, res, next) {
  try {
    const { rows: [report] } = await db.query('SELECT * FROM reports WHERE id = $1', [req.params.reportId]);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const [target, reporter, history] = await Promise.all([
      resolveTargets([report]),
      attachReporters([report]),
      db.query(
        `SELECT id, reporter_id, reason, details, status, created_at, reviewed_at, reviewed_by
           FROM reports WHERE target_type = $1 AND target_id = $2
          ORDER BY created_at DESC LIMIT 50`,
        [report.target_type, report.target_id]
      ),
    ]);

    res.json({
      ...report,
      reporter: reporter(report.reporter_id),
      target: target(report),
      target_history: history.rows,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/admin/reports/:reportId ────────────────────────────
//
// Kept for compatibility with the original endpoint. It only moves the status
// flag; /action is what actually does something.
async function reviewReport(req, res, next) {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE reports SET status = $1, reviewed_at = now(), reviewed_by = $2
        WHERE id = $3 RETURNING id, status`,
      [req.body.status, req.admin.id, req.params.reportId]
    );
    if (!row) return res.status(404).json({ error: 'Report not found' });
    req.audit.set({ action: 'report.status', targetType: 'report', targetId: row.id });
    res.json(row);
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/reports/:reportId/action ────────────────────
//
// Everything in one transaction: today's reviewReport sets a status string and
// nothing else, so "actioned" means literally nothing happened to the content
// or the account. This is what makes the word true.
const ACTIONS = ['dismiss', 'delete_content', 'ban_target', 'ban_reporter', 'warn_target', 'actioned_no_change'];

async function applyReportAction(client, { report, action, reason, adminId }) {
  const effects = [];

  if (action === 'delete_content') {
    if (report.target_type === 'post') {
      const { rowCount } = await client.query('DELETE FROM posts WHERE id = $1::uuid', [report.target_id]);
      effects.push({ type: 'post_deleted', id: report.target_id, applied: rowCount > 0 });
    } else if (report.target_type === 'story') {
      const { rowCount } = await client.query('DELETE FROM stories WHERE id = $1::uuid', [report.target_id]);
      effects.push({ type: 'story_deleted', id: report.target_id, applied: rowCount > 0 });
    } else if (report.target_type === 'message') {
      // The row stays so the conversation does not develop holes; the content
      // is replaced. There is no soft-delete column on messages today.
      const { rowCount } = await client.query(
        `UPDATE messages SET content = $2 WHERE id = $1::uuid`,
        [report.target_id, '[removed by moderation]']
      );
      effects.push({ type: 'message_redacted', id: report.target_id, applied: rowCount > 0 });
    } else {
      throw invalid('delete_content does not apply to a user report; use ban_target');
    }
  }

  if (action === 'ban_target') {
    if (report.target_type !== 'user') throw invalid('ban_target requires a user report');
    const { rowCount } = await client.query(
      `UPDATE users SET banned = true, banned_at = now(), banned_by = $2, banned_reason = $3, updated_at = now()
        WHERE id = $1`,
      [report.target_id, adminId, reason]
    );
    effects.push({ type: 'user_banned', id: report.target_id, applied: rowCount > 0 });
  }

  if (action === 'ban_reporter') {
    if (!report.reporter_id) throw invalid('This report has no reporter left to ban');
    const { rowCount } = await client.query(
      `UPDATE users SET banned = true, banned_at = now(), banned_by = $2, banned_reason = $3, updated_at = now()
        WHERE id = $1`,
      [report.reporter_id, adminId, reason]
    );
    effects.push({ type: 'reporter_banned', id: report.reporter_id, applied: rowCount > 0 });
  }

  if (action === 'warn_target') {
    if (report.target_type !== 'user') throw invalid('warn_target requires a user report');
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body)
       VALUES ($1, 'announcement', $2, $3)`,
      [report.target_id, 'A warning from Matchr', reason]
    );
    effects.push({ type: 'user_warned', id: report.target_id, applied: true });
  }

  const status = action === 'dismiss' ? 'dismissed' : 'actioned';
  await client.query(
    'UPDATE reports SET status = $1, reviewed_at = now(), reviewed_by = $2 WHERE id = $3',
    [status, adminId, report.id]
  );

  return { status, effects };
}

async function actOnReport(req, res, next) {
  const { action, reason } = req.body;
  if (!ACTIONS.includes(action)) return next(invalid(`action must be one of ${ACTIONS.join(', ')}`));

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: [report] } = await client.query(
      'SELECT * FROM reports WHERE id = $1 FOR UPDATE',
      [req.params.reportId]
    );
    if (!report) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Report not found' });
    }

    const { status, effects } = await applyReportAction(client, {
      report, action, reason, adminId: req.admin.id,
    });
    await client.query('COMMIT');

    // Side effects that must not be inside the transaction: they talk to Redis
    // and to socket instances, and a rollback could not undo them.
    const banned = effects.filter((e) => e.type.includes('banned') && e.applied).map((e) => e.id);
    if (banned.length) {
      await endSessions(banned);
      await Promise.all(banned.map((id) => invalidateCache(`cache:/api/profiles/${id}`)));
    }

    req.audit
      .set({ action: `report.${action}`, targetType: 'report', targetId: report.id, reason })
      .add({ effects, report_target: { type: report.target_type, id: report.target_id } });

    logger.warn({ admin: req.admin.id, report: report.id, action, effects }, 'Report actioned');
    res.json({ report: { id: report.id, status }, effects });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// ─── POST /api/admin/reports/bulk ────────────────────────────────
async function bulkActOnReports(req, res, next) {
  const { report_ids: reportIds, action, reason } = req.body;
  if (!ACTIONS.includes(action)) return next(invalid(`action must be one of ${ACTIONS.join(', ')}`));
  if (!Array.isArray(reportIds) || !reportIds.length) return next(invalid('report_ids is required'));
  if (reportIds.length > BULK_MAX) return next(invalid(`At most ${BULK_MAX} reports per request`));

  const affected = [];
  const failed = [];
  const banned = new Set();

  for (const reportId of [...new Set(reportIds)]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: [report] } = await client.query(
        'SELECT * FROM reports WHERE id = $1 FOR UPDATE', [reportId]
      );
      if (!report) throw new Error('Report not found');
      const { effects } = await applyReportAction(client, { report, action, reason, adminId: req.admin.id });
      await client.query('COMMIT');
      affected.push(reportId);
      effects.filter((e) => e.type.includes('banned') && e.applied).forEach((e) => banned.add(e.id));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // One bad report must not abandon the other 99 an operator selected.
      failed.push({ id: reportId, error: err.message });
    } finally {
      client.release();
    }
  }

  if (banned.size) {
    await endSessions([...banned]);
    await Promise.all([...banned].map((id) => invalidateCache(`cache:/api/profiles/${id}`)));
  }

  req.audit
    .set({ action: `report.bulk_${action}`, targetType: 'report', reason })
    .add({ requested: reportIds.length, affected: affected.length, report_ids: affected, failed });

  res.json({ affected: affected.length, report_ids: affected, failed });
}

// ─── GET /api/admin/reports/:reportId/message-context ────────────
//
// The reported message plus a small window either side, decrypted.
//
// This is the load-bearing piece of the privacy model. Without it a
// harassment report is unactionable and the moderation queue is theatre; with
// an unbounded thread reader, a phished moderator session is every
// conversation on the platform. Eleven messages, every id named in the audit
// row, is the compromise.
async function getMessageContext(req, res, next) {
  try {
    const { rows: [report] } = await db.query(
      `SELECT id, target_type, target_id FROM reports WHERE id = $1`,
      [req.params.reportId]
    );
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.target_type !== 'message') {
      return res.status(422).json({ error: 'This report does not point at a message' });
    }

    const { rows } = await db.query(
      `WITH target AS (
         SELECT m.id, m.match_id, m.created_at
           FROM messages m
          WHERE m.id = $1::uuid
       ),
       before AS (
         SELECT m.* FROM messages m, target t
          WHERE m.match_id = t.match_id AND m.created_at < t.created_at
          ORDER BY m.created_at DESC LIMIT $2
       ),
       after AS (
         SELECT m.* FROM messages m, target t
          WHERE m.match_id = t.match_id AND m.created_at > t.created_at
          ORDER BY m.created_at ASC LIMIT $2
       )
       SELECT id, match_id, sender_id, content, created_at, false AS is_target FROM before
       UNION ALL
       SELECT m.id, m.match_id, m.sender_id, m.content, m.created_at, true FROM messages m
        WHERE m.id = $1::uuid
       UNION ALL
       SELECT id, match_id, sender_id, content, created_at, false FROM after
       ORDER BY created_at`,
      [onlyUuids([report.target_id])[0] ?? null, CONTEXT_WINDOW]
    );

    if (!rows.length) return res.status(404).json({ error: 'Reported message no longer exists' });

    // Audit BEFORE decrypting. If this throws, nothing is revealed; if the
    // process dies after it, the record of what was revealed still exists.
    const auditRow = await recordFromRequest(req, {
      action: 'messages.read_context',
      targetType: 'report',
      targetId: report.id,
      metadata: {
        match_id: rows[0].match_id,
        message_count: rows.length,
        message_ids: rows.map((m) => m.id),
      },
    });
    req.audit.rowId = auditRow.id;

    res.json({
      report_id: report.id,
      match_id: rows[0].match_id,
      window: CONTEXT_WINDOW,
      messages: rows.map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        created_at: m.created_at,
        is_target: m.is_target,
        content: safeDecrypt(m.content),
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** A message encrypted under a rotated key must not 500 the whole queue. */
function safeDecrypt(content) {
  try {
    return decrypt(content);
  } catch {
    return '[could not decrypt]';
  }
}

module.exports = {
  listReports,
  getReport,
  reviewReport,
  actOnReport,
  bulkActOnReports,
  getMessageContext,
  resolveTargets,
  safeDecrypt,
  ACTIONS,
};
