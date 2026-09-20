import { createHmac, randomBytes } from 'node:crypto';

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | (buffer[i] ?? 0);
    bits += 8;

    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_CHARS.indexOf(cleaned[i] ?? '');
    if (val === -1) continue;

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates an RFC 6238 TOTP code for a given secret and counter.
 */
function generateHOTP(secretBuffer: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;

  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

export function generateTotpSecret(): string {
  return TotpService.generateSecret();
}

export function generateTotpCode(secret: string, stepSeconds = 30, digits = 6, timestamp = Date.now()): string {
  const secretBuffer = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  return generateHOTP(secretBuffer, counter);
}

export function verifyTotpCode(
  secret: string,
  token: string,
  window = 1,
  stepSeconds = 30,
  digits = 6,
  timestamp = Date.now()
): boolean {
  if (!secret || !token || token.length !== digits || !/^\d+$/.test(token)) {
    return false;
  }

  try {
    const secretBuffer = base32Decode(secret);
    const currentStep = Math.floor(timestamp / 1000 / stepSeconds);

    for (let delta = -window; delta <= window; delta++) {
      const expectedOtp = generateHOTP(secretBuffer, currentStep + delta);
      if (expectedOtp === token) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export function generateTotpUri(secret: string, accountName: string, issuer: string): string {
  return TotpService.generateOtpAuthUri(accountName, issuer, secret);
}

export class TotpService {
  /**
   * Generates a secure random 20-byte Base32 secret.
   */
  static generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /**
   * Generates an otpauth:// URI for authenticator apps (Google Authenticator, Authy).
   */
  static generateOtpAuthUri(accountName: string, issuer: string, secret: string): string {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(accountName);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
  }

  /**
   * Verifies a 6-digit TOTP code against the Base32 secret allowing clock drift of +/- 1 step (30s).
   */
  static verifyCode(secret: string, token: string): boolean {
    return verifyTotpCode(secret, token);
  }
}

