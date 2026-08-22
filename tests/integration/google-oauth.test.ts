import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { decryptToken } from '../../src/utils/encryption.js';
import { googleService } from '../../src/modules/integrations/google/google.service.js';

describe('Google OAuth Integration Module', () => {
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;

  const testEmail1 = `google.test.user1.${Date.now()}@example.com`;
  const testEmail2 = `google.test.user2.${Date.now()}@example.com`;

  const mockGoogleId = 'google-sub-id-123456789';
  const mockGoogleEmail = 'google.oauth.account@gmail.com';
  const mockRawAccessToken = 'ya29.a0AfH6SMD_MockAccessTokenValue987654321';
  const mockRawRefreshToken = '1//0gMockRefreshTokenSecretValue12345';

  beforeAll(async () => {
    // Ensure test Google client credentials are set
    (env as { GOOGLE_CLIENT_ID: string }).GOOGLE_CLIENT_ID = 'test-google-client-id';
    (env as { GOOGLE_CLIENT_SECRET: string }).GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    (env as { GOOGLE_REDIRECT_URI: string }).GOOGLE_REDIRECT_URI =
      'http://localhost:3000/api/v1/integrations/google/callback';

    // Register User 1
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Google Test User 1',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Google Org 1',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;

    // Register User 2
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Google Test User 2',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Google Org 2',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;
    user2Id = res2.body.data.user.id;
  });

  afterAll(async () => {
    // Clean up test data
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

  describe('GET /api/v1/integrations/google/connect', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/connect')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should generate Google authorization URL with valid signed state and minimal scopes', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/connect')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.url).toBeDefined();

      const parsedUrl = new URL(response.body.data.url);
      expect(parsedUrl.origin).toBe('https://accounts.google.com');
      expect(parsedUrl.pathname).toBe('/o/oauth2/v2/auth');
      expect(parsedUrl.searchParams.get('client_id')).toBe('test-google-client-id');
      expect(parsedUrl.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/api/v1/integrations/google/callback',
      );
      expect(parsedUrl.searchParams.get('response_type')).toBe('code');
      expect(parsedUrl.searchParams.get('access_type')).toBe('offline');
      expect(parsedUrl.searchParams.get('prompt')).toBe('consent');

      // Verify scopes include openid, email, profile, gmail.send, and calendar.events, but NOT Meet yet
      const scopeParam = parsedUrl.searchParams.get('scope') ?? '';
      expect(scopeParam).toContain('openid');
      expect(scopeParam).toContain('userinfo.email');
      expect(scopeParam).toContain('userinfo.profile');
      expect(scopeParam).toContain('gmail.send');
      expect(scopeParam).toContain('calendar.events');
      expect(scopeParam).not.toContain('meet');

      // Verify state parameter contains a valid signed state for user1
      const state = parsedUrl.searchParams.get('state') ?? '';
      const statePayload = googleService.verifyStateToken(state);
      expect(statePayload.userId).toBe(user1Id);
      expect(statePayload.nonce).toBeDefined();
    });
  });

  describe('GET /api/v1/integrations/google/callback - State & Error Validation', () => {
    it('should fail with 422 if state parameter is missing', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/callback?code=some-code')
        .expect(422);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should fail with 400 when state parameter is invalid or forged (anti-CSRF protection)', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/callback?code=some-code&state=invalid.forged.signature')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_OAUTH_STATE');
    });

    it('should fail with 400 when Google returns an error in callback', async () => {
      const validState = googleService.generateStateToken(user1Id);
      const response = await request(app)
        .get(
          `/api/v1/integrations/google/callback?error=access_denied&error_description=User+denied+access&state=${validState}`,
        )
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('GOOGLE_AUTH_DENIED');
    });
  });

  describe('GET /api/v1/integrations/google/callback - Successful Connection Flow', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      // Mock external Google HTTP calls
      global.fetch = jest.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();

        // 1. Google Token Exchange Endpoint
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: mockRawAccessToken,
              expires_in: 3600,
              refresh_token: mockRawRefreshToken,
              scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
              token_type: 'Bearer',
            }),
            text: async () => '',
          } as unknown as Response;
        }

        // 2. Google UserInfo Endpoint
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sub: mockGoogleId,
              email: mockGoogleEmail,
              email_verified: true,
              name: 'Google Test User',
              picture: 'https://lh3.googleusercontent.com/a/sample',
            }),
            text: async () => '',
          } as unknown as Response;
        }

        // 3. Google Revoke Endpoint
        if (urlStr.includes('oauth2.googleapis.com/revoke')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
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

    it('should successfully exchange code, persist encrypted tokens, and link Google account to user 1', async () => {
      const validState = googleService.generateStateToken(user1Id);

      const response = await request(app)
        .get(`/api/v1/integrations/google/callback?code=mock-auth-code-123&state=${validState}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(true);
      expect(response.body.data.email).toBe(mockGoogleEmail);
      expect(response.body.data.scopes).toBeDefined();

      // SECURITY CRITICAL: Ensure raw tokens NEVER appear in API response
      const responseString = JSON.stringify(response.body);
      expect(responseString).not.toContain(mockRawAccessToken);
      expect(responseString).not.toContain(mockRawRefreshToken);
      expect(response.body.data.accessToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();
      expect(response.body.data.accessTokenEncrypted).toBeUndefined();
      expect(response.body.data.refreshTokenEncrypted).toBeUndefined();

      // Verify Database Record & Encryption
      const dbRecord = await prisma.googleAccount.findUnique({
        where: { userId: user1Id },
      });

      expect(dbRecord).toBeDefined();
      expect(dbRecord?.googleId).toBe(mockGoogleId);
      expect(dbRecord?.email).toBe(mockGoogleEmail);

      // Verify tokens are stored encrypted at rest
      expect(dbRecord?.accessTokenEncrypted).not.toBe(mockRawAccessToken);
      expect(dbRecord?.refreshTokenEncrypted).not.toBe(mockRawRefreshToken);

      // Verify tokens can be correctly decrypted
      expect(decryptToken(dbRecord!.accessTokenEncrypted)).toBe(mockRawAccessToken);
      expect(decryptToken(dbRecord!.refreshTokenEncrypted!)).toBe(mockRawRefreshToken);
    });

    it('should safely update existing connection on reconnection for the same user', async () => {
      const newValidState = googleService.generateStateToken(user1Id);

      const response = await request(app)
        .get(`/api/v1/integrations/google/callback?code=new-mock-auth-code&state=${newValidState}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(true);

      const count = await prisma.googleAccount.count({
        where: { userId: user1Id },
      });
      expect(count).toBe(1);
    });

    it('should reject connection with 409 Conflict if Google account is already linked to a different user', async () => {
      // User 2 attempts to connect with the SAME Google account ID
      const user2State = googleService.generateStateToken(user2Id);

      const response = await request(app)
        .get(`/api/v1/integrations/google/callback?code=mock-auth-code-user2&state=${user2State}`)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('GOOGLE_ACCOUNT_ALREADY_LINKED');
    });
  });

  describe('GET /api/v1/integrations/google/status', () => {
    it('should return connected status for connected user without exposing tokens', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/status')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(true);
      expect(response.body.data.email).toBe(mockGoogleEmail);
      expect(response.body.data.scopes).toBeDefined();

      // Zero token exposure
      const bodyStr = JSON.stringify(response.body);
      expect(bodyStr).not.toContain(mockRawAccessToken);
      expect(bodyStr).not.toContain(mockRawRefreshToken);
      expect(response.body.data.accessToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();
    });

    it('should return disconnected status for unconnected user (user 2)', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/status')
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(false);
      expect(response.body.data.email).toBeUndefined();
    });
  });

  describe('POST /api/v1/integrations/google/disconnect', () => {
    it('should successfully disconnect and delete the Google account connection', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/disconnect')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.disconnected).toBe(true);

      // Verify removed from database
      const dbRecord = await prisma.googleAccount.findUnique({
        where: { userId: user1Id },
      });
      expect(dbRecord).toBeNull();

      // Status should now be disconnected
      const statusRes = await request(app)
        .get('/api/v1/integrations/google/status')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(statusRes.body.data.connected).toBe(false);
    });

    it('should return 404 when trying to disconnect a user with no Google connection', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/disconnect')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NO_GOOGLE_CONNECTION');
    });
  });
});
