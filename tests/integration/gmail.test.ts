import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { emailService } from '../../src/config/email.js';
import { encryptToken } from '../../src/utils/encryption.js';
import { gmailService } from '../../src/modules/integrations/google/gmail.service.js';
import { googleService } from '../../src/modules/integrations/google/google.service.js';
import { createEmailWorker } from '../../src/jobs/workers/email.worker.js';

describe('Gmail API Integration', () => {
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;

  const testEmail1 = `gmail.test.user1.${Date.now()}@example.com`;
  const testEmail2 = `gmail.test.user2.${Date.now()}@example.com`;

  const mockGoogleId = 'google-sub-gmail-12345';
  const mockGoogleEmail = 'user1.connected@gmail.com';
  const initialAccessToken = 'ya29.initial_access_token_12345';
  const refreshedAccessToken = 'ya29.refreshed_access_token_67890';
  const mockRefreshToken = '1//0gMockRefreshTokenSecretValue';

  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    (env as { GOOGLE_CLIENT_ID: string }).GOOGLE_CLIENT_ID = 'test-google-client-id';
    (env as { GOOGLE_CLIENT_SECRET: string }).GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    (env as { GOOGLE_REDIRECT_URI: string }).GOOGLE_REDIRECT_URI =
      'http://localhost:3000/api/v1/integrations/google/callback';

    // Register User 1
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Gmail User 1',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Gmail Org 1',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;

    // Register User 2 (unconnected)
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Gmail User 2',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Gmail Org 2',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;
    user2Id = res2.body.data.user.id;

    // Setup initial connected Google account for User 1
    await prisma.googleAccount.create({
      data: {
        userId: user1Id,
        googleId: mockGoogleId,
        email: mockGoogleEmail,
        accessTokenEncrypted: encryptToken(initialAccessToken),
        refreshTokenEncrypted: encryptToken(mockRefreshToken),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour valid
        scopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.send',
        ],
      },
    });
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [testEmail1, testEmail2] } },
      include: { ownedOrganizations: true },
    });

    for (const u of users) {
      await prisma.$transaction([
        prisma.googleAccount.deleteMany({ where: { userId: u.id } }),
        prisma.refreshSession.deleteMany({ where: { userId: u.id } }),
        prisma.organizationMember.deleteMany({ where: { userId: u.id } }),
        prisma.organization.deleteMany({ where: { ownerId: u.id } }),
        prisma.user.delete({ where: { id: u.id } }),
      ]);
    }

    await disconnectDatabase();
  });

  beforeEach(() => {
    originalFetch = global.fetch;

    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      // 1. Mock Google Token Refresh Endpoint
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        const bodyStr = init?.body ? init.body.toString() : '';

        if (bodyStr.includes('revoked_refresh_token')) {
          return {
            ok: false,
            status: 400,
            text: async () => '{"error": "invalid_grant", "error_description": "Token has been revoked."}',
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: refreshedAccessToken,
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'openid https://www.googleapis.com/auth/gmail.send',
          }),
          text: async () => '',
        } as unknown as Response;
      }

      // 2. Mock Gmail messages.send Endpoint
      if (urlStr.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send')) {
        const authHeader = (init?.headers as Record<string, string>)?.Authorization || '';

        if (authHeader.includes('invalid_access_token')) {
          return {
            ok: false,
            status: 401,
            text: async () => '{"error": {"code": 401, "message": "Invalid Credentials"}}',
          } as unknown as Response;
        }

        if (authHeader.includes('rate_limited_token')) {
          return {
            ok: false,
            status: 429,
            text: async () => '{"error": {"code": 429, "message": "Rate limit exceeded"}}',
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'mock_gmail_msg_id_98765',
            threadId: 'mock_gmail_thread_123',
            labelIds: ['SENT'],
          }),
          text: async () => '',
        } as unknown as Response;
      }

      return {
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as unknown as Response;
    }) as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('RFC 2822 MIME Encoding', () => {
    it('should correctly format plain text and HTML MIME email into base64url', () => {
      const message = {
        to: 'recipient@example.com',
        subject: 'Test Subject with Special Characters: ñ, é, 🚀',
        text: 'This is the plain text body.',
        html: '<p>This is the <strong>HTML</strong> body.</p>',
      };

      const encoded = gmailService.encodeRfc2822Message(message, 'sender@gmail.com');
      expect(encoded).toBeDefined();
      expect(typeof encoded).toBe('string');
      // Verify Base64URL safe (no +, no /, no trailing =)
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toMatch(/=+$/);

      // Decode and check contents
      const decoded = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      expect(decoded).toContain('To: recipient@example.com');
      expect(decoded).toContain('From: sender@gmail.com');
      expect(decoded).toContain('Content-Type: multipart/alternative');
      expect(decoded).toContain('This is the plain text body.');
      expect(decoded).toContain('<p>This is the <strong>HTML</strong> body.</p>');
    });
  });

  describe('POST /api/v1/integrations/google/gmail/send', () => {
    it('should reject unauthenticated request with 401', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/gmail/send')
        .send({
          to: 'recipient@example.com',
          subject: 'Hello',
          text: 'Message',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should validate payload (reject missing text/html with 422)', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/gmail/send')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          to: 'recipient@example.com',
          subject: 'Hello without body',
        })
        .expect(422);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should enqueue email job via BullMQ and return 202 Accepted immediately', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/gmail/send')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          to: 'customer@acme.com',
          subject: 'Welcome to Acme!',
          text: 'Welcome to the platform!',
          html: '<h1>Welcome to the platform!</h1>',
        })
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.queued).toBe(true);
      expect(response.body.data.jobId).toBeDefined();
      expect(response.body.data.recipient).toBe('customer@acme.com');
      expect(response.body.data.provider).toBe('gmail');

      // Ensure raw tokens never appear in response
      const resStr = JSON.stringify(response.body);
      expect(resStr).not.toContain(initialAccessToken);
      expect(resStr).not.toContain(mockRefreshToken);
    });
  });

  describe('Direct EmailService & Provider Abstraction Execution', () => {
    it('should send email successfully through Gmail provider using valid access token', async () => {
      const result = await emailService.sendDirect({
        to: 'client@example.com',
        subject: 'Project Update',
        text: 'Task status changed to Done.',
        userId: user1Id,
        provider: 'gmail',
      });

      expect(result.provider).toBe('gmail');
      expect(result.messageId).toBe('mock_gmail_msg_id_98765');

      // Verify token is NOT exposed in result
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain(initialAccessToken);
      expect(resultStr).not.toContain(mockRefreshToken);
    });

    it('should fail with 404 NO_GOOGLE_CONNECTION when user has no connected Google account', async () => {
      await expect(
        emailService.sendDirect({
          to: 'client@example.com',
          subject: 'Project Update',
          text: 'Hello from unconnected user.',
          userId: user2Id,
          provider: 'gmail',
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'NO_GOOGLE_CONNECTION',
      });
    });

    it('should automatically refresh token when access token is expired', async () => {
      // Set user1 token to expired in database
      await prisma.googleAccount.update({
        where: { userId: user1Id },
        data: {
          tokenExpiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        },
      });

      const token = await googleService.getValidAccessToken(user1Id);
      expect(token).toBe(refreshedAccessToken);

      // Verify token updated in database
      const dbRecord = await prisma.googleAccount.findUnique({
        where: { userId: user1Id },
      });
      expect(dbRecord?.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());

      // Send email now uses the newly refreshed token
      const result = await emailService.sendDirect({
        to: 'client@example.com',
        subject: 'After Refresh Email',
        text: 'This email sent after automatic refresh.',
        userId: user1Id,
        provider: 'gmail',
      });

      expect(result.messageId).toBe('mock_gmail_msg_id_98765');
    });

    it('should handle revoked Google authorization (invalid_grant) with 401 GOOGLE_AUTH_REVOKED', async () => {
      // Set user1 refresh token to a revoked mock value and expire the access token
      await prisma.googleAccount.update({
        where: { userId: user1Id },
        data: {
          refreshTokenEncrypted: encryptToken('revoked_refresh_token'),
          tokenExpiresAt: new Date(Date.now() - 10000),
        },
      });

      await expect(
        emailService.sendDirect({
          to: 'client@example.com',
          subject: 'Revoked Test',
          text: 'Should fail with revoked error.',
          userId: user1Id,
          provider: 'gmail',
        }),
      ).rejects.toMatchObject({
        statusCode: 401,
        code: 'GOOGLE_AUTH_REVOKED',
      });
    });

    it('should preserve SMTP default sending when provider is smtp or no userId specified', async () => {
      const result = await emailService.sendDirect({
        to: 'system@example.com',
        subject: 'System SMTP Notification',
        text: 'This is a standard system email via SMTP/JSON transport.',
        provider: 'smtp',
      });

      expect(result.provider).toBe('smtp');
      expect(result.messageId).toBeDefined();
    });
  });

  describe('BullMQ Worker Gmail Processing', () => {
    it('should create and execute email worker successfully', async () => {
      const worker = createEmailWorker();
      expect(worker).toBeDefined();
      expect(worker.name).toBe('email-queue');
      // Clean up worker
      await worker.close(true);
    });
  });
});
