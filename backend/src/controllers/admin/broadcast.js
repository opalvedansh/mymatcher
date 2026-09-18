const db = require('../../config/db');
const logger = require('../../config/logger');
const { buildSegmentWhere } = require('../../services/adminSegments');
const { recordFromRequest } = require('../../services/adminAudit');
const notificationService = require('../../services/notificationService');
const { encodeCursor, decodeCursor, clampLimit } = require('../../utils/adminQuery');

// Matches notificationService's own chunking, so the push fan-out and the
// inbox writes page at the same rate.
const CHUNK = 500;
const MAX_RECIPIENTS = 100_000;

/** Every user id in the segment, paged so a big segment never lands in one query. */
async function collectRecipients(segment, { limit = MAX_RECIPIENTS } = {}) {
  const { sql, params, from } = buildSegmentWhere(segment);
  const { rows } = await db.query(
    `SELECT u.id FROM ${from} WHERE ${sql} ORDER BY u.created_at DESC LIMIT $${params.length + 1}`,
    [...params, limit]
  );
  return rows.map((r) => r.id);
}

// ─── POST /api/admin/broadcast/preview ───────────────────────────
async function previewBroadcast(req, res, next) {
  try {
    const { sql, params, from } = buildSegmentWhere(req.body.segment);
    const { rows: [counts] } = await db.query(
      `SELECT count(*)::int                                              AS recipients,
              count(*) FILTER (WHERE u.expo_push_token IS NOT NULL)::int AS with_push_token
         FROM ${from} WHERE ${sql}`,
      params
    );
    const { rows: sample } = await db.query(
      `SELECT u.id, u.role, COALESCE(bp.name, ip.name) AS name
         FROM ${from} WHERE ${sql} ORDER BY u.created_at DESC LIMIT 10`,
      params
    );

    // Preview writes nothing and sends nothing, so it is not an auditable act.
    req.audit.skip();
    res.json({ ...counts, sample });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/broadcast ───────────────────────────────────
async function sendBroadcast(req, res, next) {
  try {
    const { segment = {}, title, body, data = {}, idempotency_key: idempotencyKey } = req.body;

    const recipients = await collectRecipients(segment);
    if (!recipients.length) return res.status(422).json({ error: 'Segment matches nobody' });

    // The row goes in first and its idempotency_key is UNIQUE, so a
    // double-submitted form hits a 23505 → 409 from errorHandler before a
    // single notification is sent. Nobody gets pushed the same thing twice.
    const { rows: [broadcast] } = await db.query(
      `INSERT INTO admin_broadcasts (admin_id, title, body, data, segment, recipient_count, idempotency_key)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING id, created_at`,
      [
        req.admin.id, title, body,
        JSON.stringify(data), JSON.stringify(segment),
        recipients.length, idempotencyKey || null,
      ]
    );

    // Audited before anything is delivered: a broadcast cannot be recalled,
    // so the record of who sent what to how many must precede the send.
    const auditRow = await recordFromRequest(req, {
      action: 'broadcast.send',
      targetType: 'broadcast',
      targetId: broadcast.id,
      metadata: { title, body, segment, recipients: recipients.length },
    });
    req.audit.rowId = auditRow.id;

    let delivered = 0;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK);
      const items = chunk.map((userId) => ({
        userId,
        type: 'announcement',
        title,
        body,
        data: { ...data, broadcast_id: broadcast.id },
      }));
      // recordNotifications fills the in-app inbox; sendBulkNotifications
      // pushes to devices through BullMQ, falling back to inline Expo sends.
      await notificationService.recordNotifications(items);
      await notificationService.sendBulkNotifications(items);
      delivered += chunk.length;
    }

    logger.warn(
      { admin: req.admin.id, broadcast: broadcast.id, recipients: recipients.length },
      'Broadcast sent'
    );
    res.json({ id: broadcast.id, recipients: recipients.length, queued: delivered });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/broadcast ────────────────────────────────────
async function listBroadcasts(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 25, 100);
    const params = [];
    const where = [];
    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      where.push(`(b.created_at, b.id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT b.id, b.admin_id, b.title, b.body, b.segment, b.recipient_count, b.created_at,
              a.email AS admin_email
         FROM admin_broadcasts b
         LEFT JOIN admin_users a ON a.user_id = b.admin_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      data,
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { previewBroadcast, sendBroadcast, listBroadcasts, collectRecipients };
