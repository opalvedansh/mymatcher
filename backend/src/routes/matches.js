const { param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { getMatches, getMatchStats, getMatchById, archiveMatch } = require('../controllers/matchController');

const router = require('express').Router();

const paginationRules = [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('cursor').optional().isISO8601()
];

const matchIdRules = [
  param('matchId').isUUID().withMessage('matchId must be a valid UUID')
];

router.use(authenticate, requireRole('brand', 'influencer'));

router.get   ('/',          paginationRules, validate, getMatches);    // list my active matches
router.get   ('/stats',     getMatchStats); // aggregate stats
router.get   ('/:matchId',  matchIdRules, validate, getMatchById);  // get match details
router.delete('/:matchId',  matchIdRules, validate, archiveMatch);  // unmatch / archive

module.exports = router;
