const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { UPLOAD_BUCKET, publicUploadPrefix } = require('../utils/storage');
const { getSupabaseAdmin } = require('../config/supabaseAdmin');

// The extension comes from the validated content type, never the client's
// filename, so an upload can't be stored as .html or .svg.
const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

let bucketReady = null;

/**
 * POST /api/upload/presigned-url
 * Body: { filename: string, contentType: string }
 */
async function generatePresignedUrl(req, res, next) {
  try {
    const { filename, contentType } = req.body;
    const { id: userId } = req.user;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType are required' });
    }

    const ext = EXTENSION_BY_TYPE[contentType];
    if (!ext) {
      return res.status(400).json({ error: 'Invalid content type. Only JPEG, PNG, WEBP allowed.' });
    }

    const objectName = `${uuidv4()}.${ext}`;
    const filePath = `uploads/${userId}/${objectName}`;

    const client = getSupabaseAdmin();
    // Creating the bucket is a network call; do it once per process, not per upload.
    bucketReady ??= client.storage.createBucket(UPLOAD_BUCKET, { public: true }).catch(() => {});
    await bucketReady;

    const { data, error } = await client
      .storage
      .from(UPLOAD_BUCKET)
      .createSignedUploadUrl(filePath);

    if (error) {
      logger.error({ err: error, userId }, '[Upload] Failed to create signed upload URL');
      return res.status(500).json({ error: 'Failed to generate upload URL' });
    }

    res.json({
      signedUrl: data.signedUrl,
      path: filePath,
      token: data.token,
      publicUrl: publicUploadPrefix(userId) + objectName,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { generatePresignedUrl };
