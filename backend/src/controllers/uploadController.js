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

// Stories may be videos (up to 60s). Only a story upload accepts them, so a
// post or a profile photo can't be a video.
const STORY_VIDEO_EXTENSIONS = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};

// Enforced by storage itself, since the client PUTs the file straight to the
// signed URL: without these a caller could store any size or content type.
// 50 MB matches the app's story video cap (app/story-camera.tsx).
const BUCKET_SETTINGS = {
  public: true,
  fileSizeLimit: 50 * 1024 * 1024,
  allowedMimeTypes: [...Object.keys(EXTENSION_BY_TYPE), ...Object.keys(STORY_VIDEO_EXTENSIONS)],
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

    const ext = EXTENSION_BY_TYPE[contentType]
      ?? (req.body.purpose === 'story' ? STORY_VIDEO_EXTENSIONS[contentType] : undefined);
    if (!ext) {
      return res.status(400).json({ error: 'Invalid content type. Only JPEG, PNG, WEBP allowed.' });
    }

    const objectName = `${uuidv4()}.${ext}`;
    const filePath = `uploads/${userId}/${objectName}`;

    const client = getSupabaseAdmin();
    // Creating the bucket is a network call; do it once per process, not per upload.
    // An existing bucket gets its limits brought in line instead.
    bucketReady ??= client.storage.createBucket(UPLOAD_BUCKET, BUCKET_SETTINGS)
      .then(({ error }) => error && client.storage.updateBucket(UPLOAD_BUCKET, BUCKET_SETTINGS))
      .then((result) => result?.error && logger.warn({ err: result.error.message }, '[Upload] could not apply bucket limits'))
      .catch(() => {});
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
