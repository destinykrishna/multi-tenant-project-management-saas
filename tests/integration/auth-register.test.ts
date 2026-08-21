import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';

describe('POST /api/v1/auth/register', () => {
  const testEmail = `test.user.${Date.now()}@example.com`;

  afterAll(async () => {
    // Clean up test data
    const user = await prisma.user.findUnique({
      where: { email: testEmail },
      include: { ownedOrganizations: true },
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

  it('should successfully register a new user, organization, and set refresh cookie', async () => {
    const payload = {
      name: 'Alice Developer',
      email: testEmail,
      password: 'StrongPassword123!',
      organizationName: 'Acme Software',
    };

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.user).toBeDefined();
    expect(response.body.data.user.email).toBe(testEmail.toLowerCase());
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(response.body.data.organization).toBeDefined();
    expect(response.body.data.organization.name).toBe('Acme Software');
    expect(response.body.data.organization.slug).toBeDefined();

    // Check refresh cookie
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/refreshToken=/);
    expect(cookies[0]).toMatch(/HttpOnly/);
  });

  it('should reject registration with an existing email (409 Conflict)', async () => {
    const payload = {
      name: 'Alice Duplicate',
      email: testEmail,
      password: 'AnotherPassword123!',
      organizationName: 'Duplicate Org',
    };

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('USER_ALREADY_EXISTS');
  });

  it('should fail with 422 if required fields are missing or invalid', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: '',
        email: 'invalid-email',
        password: 'short',
      })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toBeDefined();
  });
});
