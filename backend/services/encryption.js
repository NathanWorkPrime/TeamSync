const crypto = require('crypto');

// Default fallback key (32 bytes / 256 bits) for local/sandbox developer runs
const DEFAULT_KEY = 'a_very_secure_key_of_32_characters!';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || DEFAULT_KEY;
const IV_LENGTH = 16; // AES standard Initialization Vector length

if (ENCRYPTION_KEY === DEFAULT_KEY && process.env.NODE_ENV === 'production') {
  console.warn('[Security Warning] Using the default hardcoded encryption key in production! Set ENCRYPTION_KEY in your .env file.');
}

/**
 * Encrypts a plaintext string using AES-256-CBC
 * @param {string} text - Plaintext to encrypt
 * @returns {string} - Encrypted cipher text formatted as iv_hex:cipher_hex
 */
function encrypt(text) {
  if (!text) return null;
  
  // Ensure key is exactly 32 bytes
  const key = Buffer.concat([Buffer.from(ENCRYPTION_KEY)], 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypts a cipher string formatted as iv_hex:cipher_hex using AES-256-CBC
 * @param {string} encryptedData - Encrypted cipher text
 * @returns {string} - Decrypted plaintext string
 */
function decrypt(encryptedData) {
  if (!encryptedData) return null;
  
  try {
    const key = Buffer.concat([Buffer.from(ENCRYPTION_KEY)], 32);
    const textParts = encryptedData.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[Encryption] Failed to decrypt data:', err.message);
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt
};
