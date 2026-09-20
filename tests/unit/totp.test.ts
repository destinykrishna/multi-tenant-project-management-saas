import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateTotpUri,
} from '../../src/utils/totp.js';

describe('TOTP (RFC 6238) Unit Tests', () => {
  it('should generate a 32-character base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toBeDefined();
    expect(secret.length).toBe(32);
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
  });

  it('should generate a 6-digit numeric TOTP code', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(code).toHaveLength(6);
    expect(/^\d{6}$/.test(code)).toBe(true);
  });

  it('should verify a valid current TOTP code', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    const isValid = verifyTotpCode(secret, code);
    expect(isValid).toBe(true);
  });

  it('should accept codes within the +/- 1 step window (drift tolerance)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();

    // Past step (-30 seconds)
    const pastCode = generateTotpCode(secret, 30, 6, now - 30_000);
    expect(verifyTotpCode(secret, pastCode, 1, 30, 6, now)).toBe(true);

    // Future step (+30 seconds)
    const futureCode = generateTotpCode(secret, 30, 6, now + 30_000);
    expect(verifyTotpCode(secret, futureCode, 1, 30, 6, now)).toBe(true);
  });

  it('should reject codes outside the drift window', () => {
    const secret = generateTotpSecret();
    const now = Date.now();

    // 2 steps in the past (-60 seconds)
    const oldCode = generateTotpCode(secret, 30, 6, now - 65_000);
    expect(verifyTotpCode(secret, oldCode, 1, 30, 6, now)).toBe(false);

    // 2 steps in the future (+60 seconds)
    const futureCode = generateTotpCode(secret, 30, 6, now + 65_000);
    expect(verifyTotpCode(secret, futureCode, 1, 30, 6, now)).toBe(false);
  });

  it('should reject invalid or malformed tokens', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '000000')).toBe(false);
    expect(verifyTotpCode(secret, 'abcdef')).toBe(false);
    expect(verifyTotpCode(secret, '')).toBe(false);
  });

  it('should construct a valid standard otpauth URI', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const uri = generateTotpUri(secret, 'alice@acme.com', 'SaaS Corp');
    expect(uri).toBe(
      'otpauth://totp/SaaS%20Corp:alice%40acme.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SaaS%20Corp&algorithm=SHA1&digits=6&period=30'
    );
  });
});
