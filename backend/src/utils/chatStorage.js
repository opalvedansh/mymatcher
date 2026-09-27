const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { getSupabaseAdmin } = require('../config/supabaseAdmin');

/**
 * Chat attachments: a private bucket, readable only through signed URLs that
 * the API hands to the two people in the conversation.
 *
 * Objects live at "<senderId>/<uuid>/<file name>". The uuid folder keeps
 * names unique while the last segment stays the real file name, which is what
 * iOS shows when a document is shared or saved. The sender prefix is what
 * lets a send prove the file is the sender's own upload.
 */
const CHAT_BUCKET = 'chat-media';
const MB = 1024 * 1024;

// Supabase's global per-file limit (50 MB on the free plan) wins over these.
const MAX_BYTES = { image: 16 * MB, video: 50 * MB, audio: 16 * MB, document: 50 * MB };

// Extension by MIME type. The stored extension always comes from the
// validated type, never from the client's file name.
const IMAGE_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif',
};
const VIDEO_TYPES = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/x-m4v': 'm4v',
};
const AUDIO_TYPES = {
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/3gpp': '3gp', 'audio/amr': 'amr',
};
const DOCUMENT_TYPES = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.apple.pages': 'pages',
  'application/vnd.apple.numbers': 'numbers',
  'application/vnd.apple.keynote': 'key',
  'application/x-iwork-pages-sffpages': 'pages',
  'application/x-iwork-numbers-sffnumbers': 'numbers',
  'application/x-iwork-keynote-sffkey': 'key',
  // Unknown binary files keep their own (checked) extension; browsers download
  // octet-stream instead of rendering it.
  'application/octet-stream': null,
  // A photo, video or recording can also be sent "as a document" to keep it
  // untouched, as on WhatsApp.
  ...IMAGE_TYPES,
  ...VIDEO_TYPES,
  ...AUDIO_TYPES,
};

const TYPES_BY_KIND = { image: IMAGE_TYPES, video: VIDEO_TYPES, audio: AUDIO_TYPES, document: DOCUMENT_TYPES };
const ALL_MIME_TYPES = [...new Set(Object.values(TYPES_BY_KIND).flatMap((t) => Object.keys(t)))];

// Never stored under these names, whatever the declared type.
const BLOCKED_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'js', 'mjs', 'php', 'exe', 'bat', 'cmd', 'com', 'scr', 'msi',
  'sh', 'ps1', 'vbs', 'jar', 'apk', 'ipa', 'dmg', 'app', 'dll',
]);

const DEFAULT_NAMES = { image: 'photo', video: 'video', audio: 'voice-message', document: 'document' };

class ChatStorageError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/** The extension to store a file under, or null when the type is not allowed for this kind. */
function extensionFor(kind, mime, fileName) {
  const types = TYPES_BY_KIND[kind];
  if (!types || typeof mime !== 'string' || !Object.hasOwn(types, mime)) return null;
  const ext = types[mime];
  if (ext) return ext;
  const own = /\.([A-Za-z0-9]{1,8})$/.exec(String(fileName || ''))?.[1]?.toLowerCase();
  return own && !BLOCKED_EXTENSIONS.has(own) ? own : 'bin';
}

/**
 * A storage-safe file name. Supabase object keys only accept a limited ASCII
 * set, so anything else becomes "_"; the original name is kept (encrypted) in
 * the message itself for display.
 */
function storageFileName(kind, fileName, ext) {
  let base = String(fileName || '').replace(/\.[^.]*$/, '');
  base = base.replace(/[^A-Za-z0-9 ._()-]+/g, '_').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80);
  if (!base || !/[A-Za-z0-9]/.test(base)) base = DEFAULT_NAMES[kind];
  return `${base}.${ext}`;
}

/** True when `path` is an object this user uploaded through createUploadTarget. */
function isOwnChatPath(path, userId) {
  if (typeof path !== 'string' || path.length > 300) return false;
  const parts = path.split('/');
  return parts.length === 3
    && parts[0] === userId
    && /^[0-9a-f-]{36}$/.test(parts[1])
    && /^[A-Za-z0-9 ._()-]+$/.test(parts[2])
    && !parts[2].startsWith('.');
}

let bucketReady = null;

/**
 * Creates the private bucket on first use and keeps its limits in step with
 * this file. Retried on the next upload if it fails.
 */
function ensureBucket(client) {
  bucketReady ??= (async () => {
    const settings = { public: false, fileSizeLimit: 50 * MB, allowedMimeTypes: ALL_MIME_TYPES };
    const { error } = await client.storage.createBucket(CHAT_BUCKET, settings);
    if (!error) return;
    if (/exist/i.test(error.message || '') || error.statusCode === '409' || error.status === 409) {
      const { error: updateError } = await client.storage.updateBucket(CHAT_BUCKET, settings);
      if (updateError) logger.warn({ err: updateError.message }, '[chatStorage] could not update bucket settings');
      return;
    }
    throw error;
  })().catch((err) => {
    bucketReady = null;
    throw err;
  });
  return bucketReady;
}

/**
 * Validates an attachment the user is about to upload and returns a one-time
 * signed upload URL for it. Nothing is stored until the client PUTs the file.
 */
async function createUploadTarget(userId, { kind, mime, size, name }) {
  const ext = extensionFor(kind, mime, name);
  if (!ext || BLOCKED_EXTENSIONS.has(ext)) throw new ChatStorageError('unsupported_type', 'This file type cannot be sent');
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) throw new ChatStorageError('bad_size', 'File size is required');
  if (bytes > MAX_BYTES[kind]) {
    throw new ChatStorageError('too_large', `Files like this can be up to ${Math.round(MAX_BYTES[kind] / MB)} MB`);
  }

  const client = getSupabaseAdmin();
  await ensureBucket(client);

  const path = `${userId}/${uuidv4()}/${storageFileName(kind, name, ext)}`;
  const { data, error } = await client.storage.from(CHAT_BUCKET).createSignedUploadUrl(path);
  if (error) {
    logger.error({ err: error.message, userId }, '[chatStorage] could not create upload URL');
    throw new ChatStorageError('storage_unavailable', 'Uploads are unavailable right now');
  }
  return { path, uploadUrl: data.signedUrl, token: data.token, maxBytes: MAX_BYTES[kind] };
}

/**
 * Size and content type of an uploaded object, or null if it does not exist.
 * Throws when storage cannot be reached, so a send is retried, not dropped.
 */
async function statObject(path) {
  const { data, error } = await getSupabaseAdmin().storage.from(CHAT_BUCKET).info(path);
  if (error) {
    const status = Number(error.statusCode || error.status);
    if (status === 404 || status === 400 || /not.?found/i.test(error.message || '')) return null;
    throw new ChatStorageError('storage_unavailable', error.message);
  }
  return { size: Number(data.size) || 0, contentType: data.contentType || data.content_type || null };
}

/** Signed download URLs for many paths in one storage round trip. */
async function signPaths(paths, ttlSeconds) {
  const unique = [...new Set(paths.filter(Boolean))];
  const out = new Map();
  if (!unique.length) return out;
  const { data, error } = await getSupabaseAdmin().storage.from(CHAT_BUCKET).createSignedUrls(unique, ttlSeconds);
  if (error) {
    // Messages still load; their media shows as unavailable until the next fetch.
    logger.error({ err: error.message, count: unique.length }, '[chatStorage] could not sign URLs');
    return out;
  }
  for (const item of data || []) {
    if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  }
  return out;
}

/** Copies a file into `toUserId`'s folder (forwarding). Returns the new path. */
async function copyObject(fromPath, toUserId) {
  const fileName = fromPath.split('/').pop();
  const toPath = `${toUserId}/${uuidv4()}/${fileName}`;
  const { error } = await getSupabaseAdmin().storage.from(CHAT_BUCKET).copy(fromPath, toPath);
  if (error) throw new ChatStorageError('storage_unavailable', error.message);
  return toPath;
}

/** Best effort: a file that outlives its message is unreachable anyway. */
async function removeObjects(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  try {
    const { error } = await getSupabaseAdmin().storage.from(CHAT_BUCKET).remove(list);
    if (error) throw error;
  } catch (err) {
    logger.warn({ err: err.message, count: list.length }, '[chatStorage] could not remove files');
  }
}

/**
 * Removes every chat file a user uploaded, for account deletion. Bounded like
 * removeUserUploads: 1,000 folders per pass and at most 100 passes.
 */
async function removeUserChatMedia(admin, userId) {
  const bucket = admin.storage.from(CHAT_BUCKET);
  for (let pass = 0; pass < 100; pass++) {
    const { data: folders, error } = await bucket.list(userId, { limit: 1000 });
    if (error) {
      // No bucket yet means nothing was ever uploaded.
      if (/not.?found/i.test(error.message || '')) return;
      throw error;
    }
    if (!folders.length) return;
    const paths = [];
    for (const folder of folders) {
      if (folder.id) {
        paths.push(`${userId}/${folder.name}`);
        continue;
      }
      const { data: files, error: listError } = await bucket.list(`${userId}/${folder.name}`, { limit: 100 });
      if (listError) throw listError;
      for (const file of files) if (file.id) paths.push(`${userId}/${folder.name}/${file.name}`);
    }
    if (!paths.length) return;
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) throw removeError;
  }
}

module.exports = {
  CHAT_BUCKET,
  MAX_BYTES,
  ChatStorageError,
  extensionFor,
  storageFileName,
  isOwnChatPath,
  createUploadTarget,
  statObject,
  signPaths,
  copyObject,
  removeObjects,
  removeUserChatMedia,
  _resetBucket: () => { bucketReady = null; },
};
