const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { UPLOAD_BUCKET, publicUploadPrefix } = require('../utils/storage');

// The extension comes from the validated content type, never the client's
// filename, so an upload can't be stored as .html or .svg.
const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

let supabase = null;
let bucketReady = null;

function getSupabaseClient() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env for uploads.");
    }
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY // Needs to be the service role key to generate signed upload URLs
    );
  }
  return supabase;
}

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

    const client = getSupabaseClient();
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
