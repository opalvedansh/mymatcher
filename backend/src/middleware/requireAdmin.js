const db = require('../config/db');
const logger = require('../config/logger');
const sharedCache = require('../utils/sharedCache');

/**
 * Admin authorization.
 *
 * Permissions live in code, roles live in the database: adding a capability is
 * a deploy, not a migration, and the whole mapping is reviewable in one place.
 * Who holds a role is a row in admin_users, so granting and revoking take
 * effect without a redeploy.
 */
const PERMISSIONS = [
  'metrics:read',
  'users:read', 'users:write', 'users:ban', 'users:delete', 'users:export',
  'reports:read', 'reports:write',
  'content:read', 'content:delete',
  'verifications:read', 'verifications:write',
  'ratings:read', 'ratings:delete',
  'matches:read', 'messages:read',
  'settings:read', 'settings:write',
  'broadcast:send',
  'admins:read', 'admins:write',
  'audit:read',
  'system:read',
];

const READ_ONLY = [
  'metrics:read', 'users:read', 'reports:read', 'content:read',
  'verifications:read', 'ratings:read', 'matches:read', 'settings:read',
];

// 'messages:read' (the full decrypted thread) is superadmin-only by design.
// A moderator gets the reported message plus its neighbours through
// reports:write instead, which caps the blast radius at eleven messages.
const ROLE_PERMISSIONS = {
  superadmin: ['*'],
  moderator: [...READ_ONLY, 'reports:write', 'content:delete', 'verifications:write',
    'ratings:delete', 'users:ban', 'audit:read'],
  support: [...READ_ONLY, 'users:write', 'users:ban', 'users:export'],
  analyst: [...READ_ONLY, 'system:read'],
};

const ROLES = Object.keys(ROLE_PERMISSIONS);

// Short TTL so a revoked admin loses access within seconds even if the
// invalidation on revoke never reached this instance's Redis.
const PERMS_TTL_SECONDS = 30;
const permsKey = (userId) => `admin:perms:${userId}`;

/** The caller's active admin record, or null. Negative results are cached too. */
async function loadAdmin(userId) {
  if (!userId) return null;

  const cached = await sharedCache.get(permsKey(userId));
  if (cached !== undefined) return cached;

  const { rows } = await db.query(
    `SELECT user_id, email, role FROM admin_users
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  const admin = rows.length
    ? {
      id: rows[0].user_id,
      email: rows[0].email,
      role: rows[0].role,
      permissions: ROLE_PERMISSIONS[rows[0].role] || [],
    }
    : null;

  await sharedCache.set(permsKey(userId), admin, PERMS_TTL_SECONDS);
  return admin;
}

/** Call after any grant, revoke or role change so the cache can't outlive it. */
function invalidateAdmin(userId) {
  return sharedCache.del(permsKey(userId));
}

function has(admin, permission) {
  if (!admin) return false;
  if (admin.permissions.includes('*')) return true;
  return admin.permissions.includes(permission);
}

/** Every permission this role actually holds, with '*' expanded. */
function expandPermissions(role) {
  const granted = ROLE_PERMISSIONS[role] || [];
  return granted.includes('*') ? [...PERMISSIONS] : granted;
}

function gate(required) {
  return async function adminGate(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

      // Two gates run per request: the router mounts requireAdmin() to reject
      // non-admins early, then each route adds its own permission. Reuse the
      // record the first one loaded rather than looking it up twice — with a
      // cold cache that was two DB round trips for every admin request.
      const admin = req.admin ?? await loadAdmin(userId);
      if (!admin) {
        logger.warn(
          { user: userId, email: req.user?.email, path: req.originalUrl },
          'Admin access rejected'
        );
        return res.status(403).json({ error: 'Admin access required' });
      }

      const missing = required.find((p) => !has(admin, p));
      if (missing) {
        logger.warn(
          { admin: admin.id, role: admin.role, missing, path: req.originalUrl },
          'Admin permission denied'
        );
        return res.status(403).json({
          error: 'Insufficient admin permission',
          required_permission: missing,
          your_role: admin.role,
        });
      }

      req.admin = admin;
      // Admin responses carry PII and moderation state. Nothing may cache them.
      res.set('Cache-Control', 'no-store');
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Dual signature, on purpose.
 *
 *   router.use(authenticateTokenOnly, requireAdmin)     // any active admin
 *   router.post('/x', requireAdmin('users:ban'), h)     // a specific permission
 *
 * The first form is how routes/admin.js already calls it, so this file can be
 * replaced in its own commit without touching a single route.
 */
function requireAdmin(...args) {
  const calledAsMiddleware =
    args.length === 3 &&
    typeof args[2] === 'function' &&
    args[0] && typeof args[0].header === 'function' &&
    args[1] && typeof args[1].status === 'function';

  if (calledAsMiddleware) return gate([])(...args);
  return gate(args.flat().filter(Boolean));
}

requireAdmin.loadAdmin = loadAdmin;
requireAdmin.invalidateAdmin = invalidateAdmin;
requireAdmin.has = has;
requireAdmin.expandPermissions = expandPermissions;
requireAdmin.PERMISSIONS = PERMISSIONS;
requireAdmin.ROLE_PERMISSIONS = ROLE_PERMISSIONS;
requireAdmin.ROLES = ROLES;

module.exports = requireAdmin;
