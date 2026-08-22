import { encryptToken, decryptToken } from '../../src/utils/encryption.js';

describe('Encryption Utilities (AES-256-GCM)', () => {
  it('should encrypt and decrypt a plaintext token successfully', () => {
    const rawToken = 'ya29.a0AfH6SMD_SampleGoogleOAuthAccessToken123456789';
    const encrypted = encryptToken(rawToken);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(rawToken);
    expect(typeof encrypted).toBe('string');

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(rawToken);
  });

  it('should produce different ciphertexts for the same plaintext due to random IV', () => {
    const rawToken = 'secret-refresh-token-value';
    const encrypted1 = encryptToken(rawToken);
    const encrypted2 = encryptToken(rawToken);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decryptToken(encrypted1)).toBe(rawToken);
    expect(decryptToken(encrypted2)).toBe(rawToken);
  });

  it('should handle empty string gracefully', () => {
    expect(encryptToken('')).toBe('');
    expect(decryptToken('')).toBe('');
  });

  it('should throw an error when ciphertext is tampered with (AuthTag failure)', () => {
    const rawToken = 'confidential-access-token';
    const encrypted = encryptToken(rawToken);

    // Tamper with the base64 content
    const buffer = Buffer.from(encrypted, 'base64');
    buffer[buffer.length - 1] ^= 0xff; // flip last bit
    const tamperedBase64 = buffer.toString('base64');

    expect(() => decryptToken(tamperedBase64)).toThrow();
  });

  it('should throw an error when payload is shorter than IV + AuthTag', () => {
    const shortPayload = Buffer.from('short').toString('base64');
    expect(() => decryptToken(shortPayload)).toThrow('Invalid encrypted token payload length');
  });
});
