import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';

describe('POST /api/v1/auth/refresh', () => {
  const testEmail = `refresh.user.${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  let initialCookie: string;

  beforeAll(async () => {
    // Register user to get initial refresh token
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Refresh Tester',
      email: testEmail,
      password: testPassword,
      organizationName: 'Refresh Org',
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

  it('should successfully rotate refresh token and issue new access token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', initialCookie)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.user).toBeDefined();
    expect(response.body.data.user.email).toBe(testEmail.toLowerCase());

    // Check that a new cookie was returned
    const newCookies = response.headers['set-cookie'];
    expect(newCookies).toBeDefined();
    expect(newCookies[0]).toMatch(/refreshToken=/);
    expect(newCookies[0]).not.toEqual(initialCookie);
  });

  it('should reject reuse of an already-rotated (revoked) refresh token and invalidate active sessions (401 Unauthorized)', async () => {
    // Attempting to use the old initialCookie again
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', initialCookie)
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('TOKEN_REVOKED');

    // Confirm that all refresh sessions for this user were revoked
    const user = await prisma.user.findUnique({
      where: { email: testEmail },
    });
    const activeSessions = await prisma.refreshSession.findMany({
      where: { userId: user!.id, revokedAt: null },
    });
    expect(activeSessions.length).toBe(0);
  });

  it('should reject refresh request when no cookie is provided (401 Unauthorized)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REFRESH_TOKEN_REQUIRED');
  });

  it('should reject refresh request with an invalid/malformed token (401 Unauthorized)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refreshToken=invalid.jwt.token')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});
