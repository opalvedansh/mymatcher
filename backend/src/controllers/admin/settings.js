const settings = require('../../services/adminSettings');
const { DEFAULT_WEIGHTS } = require('../../services/feedRanking');

// ─── GET /api/admin/settings ─────────────────────────────────────
async function listSettings(req, res, next) {
  try {
    res.json({ data: await settings.listSettings() });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/settings/:key ────────────────────────────────
async function getSetting(req, res, next) {
  try {
    const all = await settings.listSettings();
    const entry = all.find((s) => s.key === req.params.key);
    if (!entry) return res.status(404).json({ error: `Unknown setting: ${req.params.key}` });
    res.json(entry);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/admin/settings/:key ────────────────────────────────
async function updateSetting(req, res, next) {
  try {
    const { key } = req.params;
    const { before, after } = await settings.updateSetting(key, req.body.value, req.admin.id);
    req.audit
      .set({ action: 'setting.update', targetType: 'setting', targetId: key, reason: req.body.reason })
      .snapshot(before, after.value);
    res.json(after);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/algorithm ────────────────────────────────────
//
// Kept at its original path and shape so the existing Expo admin screen and
// anything else pointed at it keeps working. It is now a view onto the same
// registry entry that PUT /settings/algorithm_weights writes.
async function getAlgorithmWeights(req, res, next) {
  try {
    res.json(await settings.getSetting('algorithm_weights', DEFAULT_WEIGHTS));
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/admin/algorithm ────────────────────────────────────
async function updateAlgorithmWeights(req, res, next) {
  try {
    const { before, after } = await settings.updateSetting('algorithm_weights', req.body, req.admin.id);
    req.audit
      .set({ action: 'setting.update', targetType: 'setting', targetId: 'algorithm_weights' })
      .snapshot(before, after.value);
    res.json(after.value);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSettings,
  getSetting,
  updateSetting,
  getAlgorithmWeights,
  updateAlgorithmWeights,
};
