import { hashPassword, comparePassword } from '../../src/utils/password.js';

describe('Password Utilities', () => {
  it('should hash a password and successfully verify with correct plaintext', async () => {
    const rawPassword = 'SuperSecretPassword123!';
    const hash = await hashPassword(rawPassword);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(rawPassword);
    expect(hash.startsWith('$2')).toBe(true);

    const isMatch = await comparePassword(rawPassword, hash);
    expect(isMatch).toBe(true);
  });

  it('should fail verification with an incorrect password', async () => {
    const rawPassword = 'SuperSecretPassword123!';
    const hash = await hashPassword(rawPassword);

    const isMatch = await comparePassword('WrongPassword123!', hash);
    expect(isMatch).toBe(false);
  });
});
