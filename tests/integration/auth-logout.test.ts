import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';

describe('POST /api/v1/auth/logout', () => {
  const testEmail = `logout.user.${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  let initialCookie: string;

  beforeAll(async () => {
    // Register user to get initial refresh token
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Logout Tester',
      email: testEmail,
      password: testPassword,
      organizationName: 'Logout Org',
    });

    const cookies = res.headers['set-cookie'];
    if (cookies && cookies[0]) {
      initialCookie = cookies[0];
    }
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({
      where: { email: testEmail },
    });

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

  it('should successfully log out, revoke the session in database, and clear the refresh cookie', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', initialCookie)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Logged out successfully');

    // Check that cookie was cleared (Expires in past or empty value)
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/refreshToken=;/);

    // Attempting to refresh with the logged-out token must fail
    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', initialCookie)
      .expect(401);

    expect(refreshResponse.body.success).toBe(false);
    expect(refreshResponse.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('should return 200 idempotently when logging out without a cookie', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  it('should return 200 idempotently when logging out with an invalid or non-existent token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refreshToken=non-existent-token')
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});
