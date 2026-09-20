import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateTotpCode } from '../../src/utils/totp.js';

describe('Two-Factor Authentication (TOTP) Integration Tests', () => {
  const testEmail = `totp.test.${Date.now()}@example.com`;
  const testPassword = 'Password123!Secure';
  let accessToken = '';
  let totpSecret = '';
  let mfaToken = '';

  beforeAll(async () => {
    // 1. Register a test user
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'TOTP Admin',
      email: testEmail,
      password: testPassword,
      organizationName: 'TOTP Secure Org',
    });
    accessToken = res.body.data.accessToken;
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (user) {
      await prisma.$transaction([
        prisma.refreshSession.deleteMany({ where: { userId: user.id } }),
        prisma.organizationMember.deleteMany({ where: { userId: user.id } }),
        prisma.organization.deleteMany({ where: { ownerId: user.id } }),
        prisma.user.delete({ where: { id: user.id } }),
      ]);
    }
    await disconnectDatabase();
  });

  it('POST /2fa/setup - should generate a secret and QR code URI for authenticated user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.secret).toBeDefined();
    expect(res.body.data.otpAuthUri).toMatch(/^otpauth:\/\/totp\//);
    totpSecret = res.body.data.secret;
  });

  it('POST /2fa/verify - should reject invalid verification code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '000000' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('POST /2fa/verify - should successfully enable 2FA with valid TOTP code', async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: validCode })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.success).toBe(true);
  });

  it('POST /login - should require MFA challenge when 2FA is enabled', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.requiresMfa).toBe(true);
    expect(res.body.data.mfaToken).toBeDefined();
    expect(res.body.data.accessToken).toBeUndefined();
    mfaToken = res.body.data.mfaToken;
  });

  it('POST /2fa/login - should reject incorrect MFA code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/login')
      .send({ mfaToken, code: '999999' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('POST /2fa/login - should authenticate and issue access token with valid TOTP code', async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await request(app)
      .post('/api/v1/auth/2fa/login')
      .send({ mfaToken, code: validCode })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
    accessToken = res.body.data.accessToken;
  });

  it('POST /2fa/disable - should disable 2FA with valid TOTP code', async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: validCode })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.success).toBe(true);
  });

  it('POST /login - should allow direct login without MFA after disabling', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.requiresMfa).toBeUndefined();
  });
});
