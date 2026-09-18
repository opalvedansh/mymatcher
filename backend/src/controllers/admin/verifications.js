const db = require('../../config/db');
const logger = require('../../config/logger');
const { invalidateCache } = require('../../middleware/cacheMiddleware');
const { encodeCursor, decodeCursor, clampLimit } = require('../../utils/adminQuery');

// ─── GET /api/admin/verifications ────────────────────────────────
//
// Cursor-paginated. The original handler had a bare LIMIT 100 and no cursor,
// so a queue longer than that silently truncated and the overflow was
// invisible to the operator.
async function listVerifications(req, res, next) {
  try {
    const status = req.query.status || 'pending';
    const limit = clampLimit(req.query.limit, 50, 100);
    const params = [status];
    const where = ['bp.verification_status = $1'];

    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      // Oldest first for pending (a queue), so the cursor walks forward.
      where.push(`(bp.verification_submitted_at, bp.user_id) > ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT bp.user_id, bp.name, bp.website, bp.logo_url, bp.bio, bp.location,
              bp.categories, bp.verified, bp.verification_status,
              bp.verification_business_name, bp.verification_reg_number,
              bp.verification_submitted_at, bp.verification_reviewed_at,
              bp.verification_reviewed_by, bp.verification_note,
              u.email, u.created_at AS user_created_at, u.banned,
              (SELECT count(*) FROM reports r
                WHERE r.target_type = 'user' AND r.target_id = bp.user_id)::int AS report_count
         FROM brand_profiles bp
         JOIN users u ON u.id = bp.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY bp.verification_submitted_at ASC NULLS LAST, bp.user_id ASC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data[data.length - 1];
    res.json({
      data,
      next_cursor: hasMore && last?.verification_submitted_at
        ? encodeCursor(last.verification_submitted_at, last.user_id)
        : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/admin/verifications/:userId ────────────────────────
async function reviewVerification(req, res, next) {
  try {
    const { userId } = req.params;
    const { status, note } = req.body;

    const { rows: [before] } = await db.query(
      'SELECT verification_status, verified FROM brand_profiles WHERE user_id = $1',
      [userId]
    );
    if (!before) return res.status(404).json({ error: 'Brand profile not found' });

    // No `AND verification_status = 'pending'` guard: the original handler had
    // one, which meant a mistaken approval could never be revoked. The audit
    // log is the safety net now, and revoking a wrongly granted badge is
    // exactly the thing an operator needs to be able to do.
    const { rows: [after] } = await db.query(
      `UPDATE brand_profiles
          SET verification_status = $2,
              verified = ($2 = 'approved'),
              verification_note = $3,
              verification_reviewed_at = now(),
              verification_reviewed_by = $4,
              updated_at = now()
        WHERE user_id = $1
        RETURNING user_id, verification_status, verified, verification_note,
                  verification_reviewed_at, verification_reviewed_by`,
      [userId, status, note ?? null, req.admin.id]
    );

    await invalidateCache(`cache:/api/profiles/${userId}`);

    // Tell the brand. 'announcement' only became a legal notification type in
    // migration 028; before it this insert would have failed with a 23514.
    if (before.verification_status !== status) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body)
         VALUES ($1, 'announcement', $2, $3)`,
        [
          userId,
          status === 'approved' ? 'Your business is verified' : 'Verification update',
          status === 'approved'
            ? 'Your Matchr profile now shows the verified badge.'
            : note || 'We could not verify your business with the details provided.',
        ]
      ).catch((err) => logger.warn({ err: err.message, userId }, '[admin] verification notice failed'));
    }

    req.audit
      .set({ action: 'verification.review', targetType: 'user', targetId: userId, reason: req.body.reason })
      .snapshot({ verification_status: before.verification_status, verified: before.verified }, after);

    logger.info({ userId, status, admin: req.admin.id }, 'Business verification reviewed');
    res.json(after);
  } catch (err) {
    next(err);
  }
}

module.exports = { listVerifications, reviewVerification };
