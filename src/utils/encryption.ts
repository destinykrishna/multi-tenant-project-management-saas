import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derives a 32-byte key from the configured encryption secret or JWT secret.
 */
function getEncryptionKey(): Buffer {
  const secret = env.TOKEN_ENCRYPTION_KEY || env.JWT_SECRET;
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: base64(iv + authTag + ciphertext)
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) {
    return '';
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine IV, AuthTag, and Encrypted buffer into a single payload
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts a base64 encoded ciphertext string using AES-256-GCM.
 */
export function decryptToken(encryptedBase64: string): string {
  if (!encryptedBase64) {
    return '';
  }

  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, 'base64');

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted token payload length');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
