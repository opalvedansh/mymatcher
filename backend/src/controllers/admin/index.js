/**
 * Barrel for the admin controllers.
 *
 * Every export name the old single-file adminController.js had still resolves
 * through here (getStats, listUsers, banUser, unbanUser, deleteUser,
 * bulkBanUsers, bulkUnbanUsers, getAlgorithmWeights, updateAlgorithmWeights,
 * listVerifications, reviewVerification), so ../adminController.js can be a
 * one-line shim and nothing that required the old path breaks.
 */
module.exports = {
  ...require('./metrics'),
  ...require('./users'),
  ...require('./moderation'),
  ...require('./content'),
  ...require('./verifications'),
  ...require('./ratings'),
  ...require('./conversations'),
  ...require('./settings'),
  ...require('./broadcast'),
  ...require('./admins'),
  ...require('./system'),
};
