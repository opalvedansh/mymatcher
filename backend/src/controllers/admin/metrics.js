const metrics = require('../../services/adminMetrics');

// ─── GET /api/admin/stats ────────────────────────────────────────
async function getStats(req, res, next) {
  try {
    res.json(await metrics.getStats());
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/metrics/timeseries ───────────────────────────
async function getTimeseries(req, res, next) {
  try {
    const range = metrics.normalizeRange(req.query, 30);
    res.json(await metrics.getTimeseries(range));
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/metrics/funnel ───────────────────────────────
async function getFunnel(req, res, next) {
  try {
    const { role } = req.query;
    if (role && !['brand', 'influencer'].includes(role)) {
      throw metrics.rangeError('role must be brand or influencer');
    }
    const range = metrics.normalizeRange(req.query, 30);
    res.json(await metrics.getFunnel({ from: range.from, to: range.to, role: role || null }));
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/metrics/breakdown ────────────────────────────
async function getBreakdown(req, res, next) {
  try {
    const data = await metrics.getBreakdown(req.query.dimension);
    res.json({ dimension: req.query.dimension, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStats, getTimeseries, getFunnel, getBreakdown };
