const logger = require('../config/logger');
const { record, patchStatus, clientIp, redact } = require('../services/adminAudit');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Records every mutating admin request, automatically.
 *
 * Mounted once on the admin router. The row is written on `finish`, which is
 * after the handler ran — so req.route is populated (the action name comes
 * free from the matched route pattern rather than a registry) and
 * res.statusCode is the real outcome, including failures. Handlers add detail
 * through req.audit; a handler that adds nothing still produces a usable row.
 */
function adminAudit(req, res, next) {
  req.audit = {
    action: null,
    targetType: null,
    targetId: null,
    reason: null,
    meta: {},
    before: null,
    after: null,
    force: false,      // set true to audit a GET (exports, message reads)
    suppressed: false,
    rowId: null,       // set when the row was written before the action ran

    set(fields) { Object.assign(this, fields); return this; },
    add(meta) { Object.assign(this.meta, meta); return this; },
    snapshot(before, after) { this.before = before; this.after = after; return this; },
    skip() { this.suppressed = true; return this; },
  };

  let written = false;
  const flush = () => {
    if (written) return;
    written = true;

    // No req.admin means the gate rejected the caller; requireAdmin already
    // logged that, and an unauthenticated probe must not be able to write rows.
    if (req.audit.suppressed || !req.admin) return;
    if (READ_METHODS.has(req.method) && !req.audit.force) return;

    const routePath = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.originalUrl.split('?')[0];
    const action = req.audit.action || `${req.method} ${routePath}`;

    // The row already exists (a mandatory pre-write) — only the outcome is new.
    const work = req.audit.rowId
      ? patchStatus(req.audit.rowId, res.statusCode)
      : record({
        adminId: req.admin.id,
        adminEmail: req.admin.email,
        action,
        targetType: req.audit.targetType,
        targetId: req.audit.targetId ?? req.params?.userId ?? req.params?.id ?? null,
        reason: req.audit.reason ?? req.body?.reason ?? null,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
        status: res.statusCode,
        metadata: {
          params: req.params && Object.keys(req.params).length ? req.params : undefined,
          query: req.query && Object.keys(req.query).length ? redact(req.query) : undefined,
          body: req.body && Object.keys(req.body).length ? redact(req.body) : undefined,
          before: req.audit.before ?? undefined,
          after: req.audit.after ?? undefined,
          ...req.audit.meta,
        },
      });

    // An audit failure must never turn a successful action into a 500 — the
    // response has already been sent. It is logged loudly instead.
    work.catch((err) => logger.error(
      { err: err.message, action, admin: req.admin.id }, '[audit] write failed'
    ));
  };

  res.on('finish', flush);
  res.on('close', flush);   // aborted request: still record the attempt
  next();
}

module.exports = adminAudit;
