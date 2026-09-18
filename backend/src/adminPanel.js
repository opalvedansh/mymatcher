const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('./config/logger');

/**
 * Serves the admin SPA from the API's own origin at /admin.
 *
 * Same origin means the panel needs no CORS entry and no cookie handling: it
 * sends the Supabase access token as a Bearer header to /api/admin/*, which
 * is already what the mobile client does.
 *
 * The build lands in backend/public/admin — the root Dockerfile's first stage
 * builds admin/ and copies dist there. When it is absent (a plain `npm run
 * dev` with no panel build) every route below no-ops, so the API starts
 * exactly as before.
 */
const PANEL_DIR = path.join(__dirname, '../public/admin');
const INDEX_HTML = path.join(PANEL_DIR, 'index.html');

function panelExists() {
  try {
    return fs.existsSync(INDEX_HTML);
  } catch {
    return false;
  }
}

/** The Supabase origin the panel must be allowed to talk to and load images from. */
function supabaseOrigin() {
  try {
    return new URL(process.env.SUPABASE_URL).origin;
  } catch {
    return '';
  }
}

/**
 * A CSP scoped to /admin.
 *
 * helmet's default policy is applied to the API as a whole and is right for
 * JSON, but it blocks the things this page legitimately needs:
 *   style-src 'unsafe-inline' — React and Recharts set style attributes
 *   img-src   the Supabase storage origin — every avatar and uploaded photo
 *   connect-src the Supabase auth origin — sign-in happens in the browser
 * Scripts stay 'self' only: no inline script, no CDN, no eval.
 */
function adminPanelSecurityHeaders(req, res, next) {
  if (!req.path.startsWith('/admin')) return next();

  const supabase = supabaseOrigin();
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob:${supabase ? ` ${supabase}` : ''} https:`,
    `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace(/^https/, 'wss')}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  res.setHeader('Content-Security-Policy', directives.join('; '));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

function mountAdminPanel(app) {
  // Public and unauthenticated on purpose: both values already ship inside the
  // mobile app bundle, and serving them here means the Docker image carries no
  // build-time environment at all — one image works in every environment.
  app.get('/admin/env.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      `window.__ADMIN_ENV__=${JSON.stringify({
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
        commit: (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || '').slice(0, 7),
        env: process.env.NODE_ENV || 'development',
      })};`
    );
  });

  if (!panelExists()) {
    logger.info('[admin] panel build not found at public/admin — serving API only');
    app.get(/^\/admin(\/.*)?$/, (_req, res) =>
      res.status(503).json({ error: 'Admin panel is not built in this deployment' }));
    return;
  }

  // Hashed asset filenames, so a long max-age is safe and correct.
  app.use('/admin', express.static(PANEL_DIR, {
    maxAge: '1y',
    index: false,
    // Without this, serve-static answers /admin with a 301 to /admin/ and
    // replaces the CSP set above with its own `default-src 'none'`. The
    // fallback below already serves both spellings.
    redirect: false,
    // index.html is the one file whose name never changes; caching it would
    // pin browsers to the previous build after a deploy.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Client-side routing: anything under /admin that is not a real file is the
  // app itself. Registered after express.static so real assets still 404
  // properly rather than returning HTML with a 200.
  app.get(/^\/admin(\/.*)?$/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(INDEX_HTML);
  });

  logger.info('[admin] panel mounted at /admin');
}

module.exports = { mountAdminPanel, adminPanelSecurityHeaders, PANEL_DIR, panelExists };
