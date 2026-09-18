const db = require('../config/db');
const logger = require('../config/logger');
const { getSupabaseAdmin } = require('../config/supabaseAdmin');
const { UPLOAD_BUCKET } = require('../utils/storage');
const { endSessions } = require('../utils/sessions');

/**
 * Removes every file this user uploaded through /api/upload.
 *
 * Bounded: each pass removes up to 100 files; 1,000 passes is far beyond any
 * real account and stops a bad listing from looping forever.
 */
async function removeUserUploads(admin, userId) {
  const folder = `uploads/${userId}`;
  const bucket = admin.storage.from(UPLOAD_BUCKET);
  for (let pass = 0; pass < 1000; pass++) {
    const { data, error } = await bucket.list(folder, { limit: 100 });
    if (error) throw error;
    // Folder placeholders have no id and can't be removed.
    const files = data.filter((entry) => entry.id);
    if (!files.length) return;
    const { error: removeError } = await bucket.remove(files.map((f) => `${folder}/${f.name}`));
    if (removeError) throw removeError;
  }
}

/**
 * The one place an account is really destroyed.
 *
 * Order matters: files and rows first, the Supabase auth identity last, so a
 * failure is retryable rather than leaving an identity with no data behind it.
 *
 * Both safetyController.deleteAccount (the user deleting themselves) and the
 * admin hard delete call this. They used to be two implementations, and the
 * admin one was a bare `DELETE FROM users` — it left the auth identity and
 * every uploaded file behind, so a "deleted" user could sign straight back in.
 */
async function hardDeleteUser(userId, { actorId, reason } = {}) {
  const admin = getSupabaseAdmin();

  await removeUserUploads(admin, userId);

  // Cascades to profiles, swipes, matches, messages, posts, likes, stories,
  // story views, ratings and blocks. Reports keep a NULL reporter (021).
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [userId]);

  // 404 means the identity is already gone — that is the desired end state.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && error.status !== 404) throw error;

  await endSessions([userId]);

  logger.warn({ userId, actorId: actorId || userId, reason }, 'Account hard-deleted');
  return { deleted: rowCount > 0 };
}

/**
 * Reversible removal. Sets `banned` as well as `deleted_at` so the existing
 * check in middleware/auth.js blocks sign-in with no change to the hot path.
 */
async function softDeleteUser(userId, { actorId, reason } = {}) {
  const { rowCount } = await db.query(
    `UPDATE users
        SET deleted_at = now(),
            banned = true,
            banned_at = COALESCE(banned_at, now()),
            banned_by = COALESCE(banned_by, $2),
            banned_reason = COALESCE(banned_reason, $3),
            updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId, actorId || null, reason || null]
  );
  if (rowCount) await endSessions([userId]);
  return { deleted: rowCount > 0 };
}

async function restoreUser(userId) {
  const { rowCount } = await db.query(
    `UPDATE users
        SET deleted_at = NULL, banned = false, banned_at = NULL,
            banned_by = NULL, banned_reason = NULL, updated_at = now()
      WHERE id = $1 AND deleted_at IS NOT NULL`,
    [userId]
  );
  if (rowCount) await endSessions([userId], { disconnect: false });
  return { restored: rowCount > 0 };
}

module.exports = { hardDeleteUser, softDeleteUser, restoreUser, removeUserUploads };
