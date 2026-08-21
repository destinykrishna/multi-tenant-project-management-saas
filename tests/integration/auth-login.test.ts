import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';

describe('POST /api/v1/auth/login', () => {
  const testEmail = `login.user.${Date.now()}@example.com`;
  const testPassword = 'SecurePassword123!';

  beforeAll(async () => {
    // Register a user first
    await request(app).post('/api/v1/auth/register').send({
      name: 'Login Tester',
      email: testEmail,
      password: testPassword,
      organizationName: 'Login Test Org',
    });
  });

  afterAll(async () => {
    // Clean up test data
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

  it('should successfully log in with valid credentials and return access token + cookie', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail.toUpperCase(), // Test case insensitivity
        password: testPassword,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.user).toBeDefined();
    expect(response.body.data.user.email).toBe(testEmail.toLowerCase());
    expect(response.body.data.user.passwordHash).toBeUndefined();

    // Check refresh cookie
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/refreshToken=/);
    expect(cookies[0]).toMatch(/HttpOnly/);
  });

  it('should reject login with wrong password (401 Unauthorized)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'WrongPassword!',
      })
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('should reject login with non-existent email (401 Unauthorized)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'nonexistent@example.com',
        password: testPassword,
      })
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('should reject login with invalid payload (422 Validation Error)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'not-an-email',
        password: '',
      })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
