const db = require('../config/db');

/**
 * SQL condition that is true when either user has blocked the other.
 * `a` and `b` are SQL expressions written in code (e.g. '$1', 'u.id'),
 * never request data.
 */
function blockedBetween(a, b) {
  return `EXISTS (
    SELECT 1 FROM user_blocks ub
    WHERE (ub.blocker_id = ${a} AND ub.blocked_id = ${b})
       OR (ub.blocker_id = ${b} AND ub.blocked_id = ${a})
  )`;
}

async function isBlockedBetween(userA, userB) {
  const { rows } = await db.query(`SELECT ${blockedBetween('$1', '$2')} AS blocked`, [userA, userB]);
  return rows[0].blocked;
}

module.exports = { blockedBetween, isBlockedBetween };
