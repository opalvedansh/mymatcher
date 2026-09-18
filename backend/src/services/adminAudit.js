const db = require('../config/db');

const MAX_METADATA_BYTES = 8192;
const MAX_ARRAY_ITEMS = 50;
const MAX_UA = 300;

// Never persisted: secrets, and anything that would put message plaintext or a
// bearer token into a table the whole admin team can read.
const REDACTED_KEYS = new Set([
  'password', 'token', 'access_token', 'refresh_token', 'authorization',
  'service_role_key', 'encryption_key', 'content', 'plaintext', 'expo_push_token',
]);

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.length > MAX_ARRAY_ITEMS
      ? [
        ...value.slice(0, MAX_ARRAY_ITEMS).map((v) => redact(v, depth + 1)),
        `…+${value.length - MAX_ARRAY_ITEMS} more`,
      ]
      : value.map((v) => redact(v, depth + 1));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function capMetadata(metadata) {
  const json = JSON.stringify(redact(metadata ?? {}));
  return json.length > MAX_METADATA_BYTES
    ? JSON.stringify({ truncated: true, bytes: json.length })
    : json;
}

/** req.ip is often ::ffff:1.2.3.4; INET accepts it, but the v4 form reads better. */
function clientIp(req) {
  const raw = req.ip || '';
  const ip = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

async function record({
  adminId, adminEmail, action, targetType, targetId,
  reason, metadata, ip, userAgent, status,
}) {
  const { rows } = await db.query(
    `INSERT INTO admin_audit_log
       (admin_id, admin_email, action, target_type, target_id, reason, metadata, ip, user_agent, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::inet, $9, $10)
     RETURNING id, created_at`,
    [
      adminId,
      adminEmail || null,
      action,
      targetType || null,
      targetId == null ? null : String(targetId),
      reason || null,
      capMetadata(metadata),
      ip || null,
      userAgent ? String(userAgent).slice(0, MAX_UA) : null,
      status ?? null,
    ]
  );
  return rows[0];
}

/** Writes the outcome onto a row that was written before the action ran. */
async function patchStatus(id, status) {
  await db.query('UPDATE admin_audit_log SET status = $2 WHERE id = $1', [id, status]);
}

/**
 * For handlers that must prove the intent was recorded before acting —
 * messages.read, user.hard_delete, broadcast.send. If the process dies
 * mid-handler the intent is already durable.
 */
function recordFromRequest(req, overrides = {}) {
  return record({
    adminId: req.admin?.id || req.user?.id || 'unknown',
    adminEmail: req.admin?.email || req.user?.email,
    ip: clientIp(req),
    userAgent: req.headers?.['user-agent'],
    reason: req.body?.reason || req.query?.reason || null,
    ...overrides,
  });
}

/** Only the keys that actually changed, so a 40-column profile edit stays small. */
function diffOnly(before, after) {
  const changed = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changed[key] = { from: a, to: b };
  }
  return changed;
}

module.exports = { record, patchStatus, recordFromRequest, redact, clientIp, diffOnly };
