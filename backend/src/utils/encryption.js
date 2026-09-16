const crypto = require('crypto');
const util = require('util');
const logger = require('../config/logger');

const randomBytesAsync = util.promisify(crypto.randomBytes);

const ALGORITHM = 'aes-256-gcm';
const TEST_KEY = 'super-secret-default-key-that-is-exactly-32-b';

// A 64-char hex string is used as the full 32 bytes. Any other string keeps
// the original derivation (first 32 characters) so existing messages still
// decrypt.
function deriveKey(raw) {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return Buffer.from(raw.substring(0, 32));
}

const rawKey = process.env.ENCRYPTION_KEY
  || (process.env.NODE_ENV === 'production' ? null : TEST_KEY);

if (!rawKey) {
  // A publicly known fallback key would make "encrypted" messages readable by
  // anyone with the source, so production refuses to encrypt without one.
  logger.error('ENCRYPTION_KEY is not set — chat messages cannot be encrypted or read.');
}

const KEY = rawKey ? deriveKey(rawKey) : null;

function requireKey() {
  if (!KEY) throw new Error('ENCRYPTION_KEY is not configured');
  return KEY;
}

/**
 * Encrypts plaintext into a securely authenticated ciphertext format
 * Format: "iv:authTag:ciphertext"
 */
async function encrypt(text) {
  if (!text) return text;
  const key = requireKey();

  // Create a 96-bit (12 byte) Initialization Vector asynchronously to avoid blocking the event loop
  const iv = await randomBytesAsync(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a previously encrypted string.
 * Format: "iv:authTag:ciphertext"
 * Note: Made async for API consistency with encrypt()
 */
async function decrypt(hash) {
  if (!hash || !hash.includes(':')) return hash; // If not encrypted format, return as is
  // Reads degrade to a placeholder so match lists still load without a key.
  if (!KEY) return '*** [Encrypted Message] ***';
  const key = KEY;

  try {
    const parts = hash.split(':');
    if (parts.length !== 3) return hash;

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    logger.error({ err: err.message }, '[Encryption] Failed to decrypt message');
    return '*** [Encrypted Message] ***'; // Failsafe
  }
}

module.exports = { encrypt, decrypt };
