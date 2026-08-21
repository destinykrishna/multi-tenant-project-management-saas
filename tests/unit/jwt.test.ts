import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
} from '../../src/utils/jwt.js';

describe('JWT Utilities', () => {
  it('should generate and verify an access token payload', () => {
    const payload = {
      userId: 'user-uuid-abc',
      email: 'jwt.tester@example.com',
    };

    const token = generateAccessToken(payload);
    expect(token).toBeDefined();

    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.email).toBe(payload.email);
  });

  it('should generate and verify a refresh token payload', () => {
    const payload = {
      userId: 'user-uuid-abc',
      tokenId: 'token-uuid-xyz',
    };

    const token = generateRefreshToken(payload);
    expect(token).toBeDefined();

    const decoded = verifyRefreshToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.tokenId).toBe(payload.tokenId);
  });

  it('should compute deterministic SHA-256 token hash', () => {
    const rawToken = 'my-super-long-raw-token';
    const hash1 = hashToken(rawToken);
    const hash2 = hashToken(rawToken);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it('should compute refresh token expiry approximately 7 days in future', () => {
    const expiry = getRefreshTokenExpiry();
    const now = new Date();

    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThanOrEqual(7.1);
  });
});
