const crypto = require('crypto');
const util = require('util');
const logger = require('../config/logger');

const randomBytesAsync = util.promisify(crypto.randomBytes);

const ALGORITHM = 'aes-256-gcm';
const TEST_KEY = 'super-secret-default-key-that-is-exactly-32-b';
const PLACEHOLDER = '*** [Encrypted Message] ***';

// "iv:authTag:ciphertext" in hex: a 12-byte IV and a 16-byte tag. Matching the
// exact shape, not just "contains a colon", keeps plaintext such as
// "see you at 10:30" or a JSON attachment from being mistaken for ciphertext.
const CIPHERTEXT_RE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/i;

// A 64-char hex string is used as the full 32 bytes. Other strings of 32+
// characters keep the original derivation (first 32 characters) so existing
// messages still decrypt. Anything shorter used to make every send throw
// "Invalid key length", so nothing was ever encrypted with it and hashing it
// up to 32 bytes breaks nothing.
function deriveKey(raw) {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const legacy = Buffer.from(raw.substring(0, 32));
  if (legacy.length === 32) return legacy;
  return crypto.createHash('sha256').update(raw).digest();
}

const IS_PROD = process.env.NODE_ENV === 'production';
const configuredKey = process.env.ENCRYPTION_KEY || '';

// Without a key, production stores new messages as plaintext rather than
// refusing them. Refusing looked safer, but it silently broke every chat
// send from 2026-09-17 until the key was noticed missing; a publicly known
// fallback key would be no better than plaintext and only look encrypted.
const KEY = configuredKey ? deriveKey(configuredKey) : IS_PROD ? null : deriveKey(TEST_KEY);

// Before 2026-09-17 production encrypted with the public test key whenever
// ENCRYPTION_KEY was unset. Those rows are readable by anyone with the source
// either way, so trying that key last keeps them readable after a real key
// is configured.
const LEGACY_KEY = deriveKey(TEST_KEY);
const DECRYPT_KEYS = KEY && KEY.equals(LEGACY_KEY) ? [KEY] : [KEY, LEGACY_KEY].filter(Boolean);

const STATUS = configuredKey ? 'configured' : IS_PROD ? 'disabled' : 'development_key';

if (STATUS === 'disabled') {
  logger.error(
    'ENCRYPTION_KEY is not set: new chat messages are stored WITHOUT encryption. '
    + 'Set a 64-character hex key (openssl rand -hex 32) on every service that runs chat.'
  );
} else if (configuredKey && !/^[0-9a-fA-F]{64}$/.test(configuredKey) && configuredKey.length < 32) {
  logger.warn('ENCRYPTION_KEY is shorter than 32 characters; use a 64-character hex key (openssl rand -hex 32).');
}

/** 'configured' | 'development_key' | 'disabled' (production without a key). */
function encryptionStatus() {
  return STATUS;
}

/**
 * Encrypts plaintext into an authenticated "iv:authTag:ciphertext" string.
 * Returns the input unchanged when it is empty or no key is configured.
 */
async function encrypt(text) {
  if (!text) return text;
  if (!KEY) return text;

  // Create a 96-bit (12 byte) Initialization Vector asynchronously to avoid blocking the event loop
  const iv = await randomBytesAsync(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a value written by encrypt(). Anything that is not in the
 * ciphertext format (plaintext rows) is returned as is.
 * Note: Made async for API consistency with encrypt()
 */
async function decrypt(value) {
  if (!value || !CIPHERTEXT_RE.test(value)) return value;
  if (!DECRYPT_KEYS.length) return PLACEHOLDER;

  const [ivHex, tagHex, dataHex] = value.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');

  for (const key of DECRYPT_KEYS) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(dataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      // Wrong key (or tampered data): try the next one.
    }
  }
  logger.error('[Encryption] Failed to decrypt message');
  return PLACEHOLDER; // Failsafe
}

module.exports = { encrypt, decrypt, encryptionStatus, isCiphertext: (v) => typeof v === 'string' && CIPHERTEXT_RE.test(v) };
