/**
 * Kept for one release so anything still requiring this path keeps working.
 * The implementation moved to ./admin/ when this file outgrew a single module.
 * Delete this shim once nothing imports it.
 */
module.exports = require('./admin');
