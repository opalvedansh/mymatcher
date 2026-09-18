const router = require('express').Router();
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/system');

router.get('/system', requireAdmin('system:read'), c.getSystem);

// /api-docs is gated in production; the spec lives here instead.
router.get('/openapi.json', requireAdmin('system:read'), c.getOpenApiSpec);

module.exports = router;
