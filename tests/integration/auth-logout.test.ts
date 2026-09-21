import http from 'node:http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../../src/app.js';
import { initSocketServer, closeSocketServer } from '../../src/config/socket.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { redis } from '../../src/config/redis.js';
import { tokenRevocationBloom } from '../../src/utils/bloom.js';
import { env } from '../../src/config/env.js';
import type { AccessTokenPayload } from '../../src/utils/jwt.js';

describe('POST /api/v1/auth/logout & Distributed JTI Revocation', () => {
  let httpServer: http.Server;
  let port: number;
  const openSockets: ClientSocket[] = [];

  const testEmail = `logout.user.${Date.now()}@example.com`;
  const otherEmail = `unrelated.user.${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  let initialAccessToken: string;
  let initialRefreshTokenCookie: string;
  let initialJti: string;
  let otherAccessToken: string;

  function createClient(token?: string): ClientSocket {
    const client = ioc(`http://localhost:${port}`, {
      auth: token ? { token } : undefined,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    openSockets.push(client);
    return client;
  }

  beforeAll(async () => {
    // 1. Start HTTP + Socket.IO server on ephemeral port
    httpServer = http.createServer(app);
    initSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
        }
        resolve();
      });
    });

    // 2. Register main test user
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Logout Tester',
      email: testEmail,
      password: testPassword,
      organizationName: 'Logout Org',
    });

    initialAccessToken = res.body.data.accessToken;
    const cookies = res.headers['set-cookie'];
    if (cookies && cookies[0]) {
      initialRefreshTokenCookie = cookies[0];
    }

    const payload = jwt.decode(initialAccessToken) as AccessTokenPayload;
    initialJti = payload.jti!;

    // 3. Register unrelated user to verify their token is never revoked
    const otherRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Other Tester',
      email: otherEmail,
      password: testPassword,
      organizationName: 'Other Org',
    });

    otherAccessToken = otherRes.body.data.accessToken;
  });

  afterAll(async () => {
    // Disconnect client sockets
    for (const s of openSockets) {
      if (s.connected) {
        s.disconnect();
      }
    }

    await closeSocketServer();

    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }

    // Cleanup users and sessions
    const users = await prisma.user.findMany({
      where: { email: { in: [testEmail, otherEmail] } },
    });

    for (const user of users) {
      await prisma.refreshSession.deleteMany({ where: { userId: user.id } });
      await prisma.organizationMember.deleteMany({ where: { userId: user.id } });
      await prisma.organization.deleteMany({ where: { ownerId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }

    // Clean up test keys from Redis
    if (initialJti) {
      await redis.del(`revoked:jti:${initialJti}`);
    }

    await disconnectDatabase();
  });

  it('1. login produces a valid access token with a unique JTI', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: testEmail,
      password: testPassword,
    }).expect(200);

    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.accessToken).toBeDefined();

    const decoded = jwt.verify(loginRes.body.data.accessToken, env.JWT_SECRET) as AccessTokenPayload;
    expect(decoded.userId).toBeDefined();
    expect(decoded.email).toBe(testEmail);
    expect(decoded.jti).toBeDefined();
  });

  it('2. access token works before logout (200)', async () => {
    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('3. logout revokes the refresh session in database and clears the cookie (200)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', initialRefreshTokenCookie)
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Logged out successfully');

    // Cookie is cleared
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/refreshToken=;/);

    // Refresh token reuse is rejected
    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', initialRefreshTokenCookie)
      .expect(401);

    expect(refreshResponse.body.success).toBe(false);
    expect(refreshResponse.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('4. logout with a valid access token revokes its JTI in distributed Redis denylist', async () => {
    // Verify Redis has the key
    const exists = await redis.exists(`revoked:jti:${initialJti}`);
    expect(exists).toBe(1);
  });

  it('5. the same access token is rejected with 401 TOKEN_REVOKED after logout', async () => {
    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('6. logout still succeeds when the access token is expired or invalid (200)', async () => {
    // 6a. Malformed / invalid access token
    const invalidRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer invalid-token-string')
      .expect(200);

    expect(invalidRes.body.success).toBe(true);

    // 6b. Expired access token
    const expiredToken = jwt.sign(
      { userId: 'user-expired', email: 'expired@example.com', jti: 'expired-jti-123' },
      env.JWT_SECRET,
      { expiresIn: '-10s' },
    );

    const expiredRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(200);

    expect(expiredRes.body.success).toBe(true);
  });

  it('7. a revoked JTI remains rejected after the local process/Bloom state is unavailable (restart survival)', async () => {
    // Simulate process restart or multi-instance where local in-memory Bloom filter is blank
    tokenRevocationBloom.clearLocalState();

    // Verify local sync check is currently blank
    expect(tokenRevocationBloom.isRevoked(initialJti)).toBe(false);

    // Protected route must STILL reject the revoked token because Redis is authoritative!
    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('8. Redis TTL is bounded by the access token remaining lifetime', async () => {
    const ttl = await redis.ttl(`revoked:jti:${initialJti}`);
    // Default JWT access token expires in 15 minutes (900 seconds)
    // The remaining TTL in Redis must be strictly > 0 and <= 900
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('9. an unrelated valid access token is NOT revoked (200)', async () => {
    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('10. revoked HTTP access token cannot be accepted when Redis is unavailable (fails closed)', async () => {
    // Clear local state so local bloom has no cached hit
    tokenRevocationBloom.clearLocalState();

    const spy = jest.spyOn(redis, 'exists').mockRejectedValueOnce(new Error('Redis connection failure'));

    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${initialAccessToken}`);

    // Must NOT be accepted (200)! Must fail closed with 503 AUTH_SERVICE_UNAVAILABLE
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_SERVICE_UNAVAILABLE');

    spy.mockRestore();
  });

  it('11. Socket.IO rejects a revoked JTI on another instance / local-state miss', async () => {
    // Clear local in-memory state to simulate connection hitting another backend instance
    tokenRevocationBloom.clearLocalState();
    expect(tokenRevocationBloom.isRevoked(initialJti)).toBe(false);

    const client = createClient(initialAccessToken);

    const errMessage = await new Promise<string>((resolve) => {
      client.on('connect_error', (err) => resolve(err.message));
      client.on('connect', () => resolve('CONNECTED'));
    });

    expect(errMessage).toBe('TOKEN_REVOKED');
  });

  it('12. Socket.IO rejects a revoked JTI after local state is cleared', async () => {
    tokenRevocationBloom.clearLocalState();

    const client = createClient(initialAccessToken);

    const errMessage = await new Promise<string>((resolve) => {
      client.on('connect_error', (err) => resolve(err.message));
      client.on('connect', () => resolve('CONNECTED'));
    });

    expect(errMessage).toBe('TOKEN_REVOKED');
  });

  it('13. Redis-unavailable Socket.IO authentication fails closed', async () => {
    tokenRevocationBloom.clearLocalState();

    const spy = jest.spyOn(redis, 'exists').mockRejectedValueOnce(new Error('Redis connection timeout'));

    // Try connecting with otherAccessToken (valid token) while Redis is down
    const client = createClient(otherAccessToken);

    const errMessage = await new Promise<string>((resolve) => {
      client.on('connect_error', (err) => resolve(err.message));
      client.on('connect', () => resolve('CONNECTED'));
    });

    expect(errMessage).toBe('AUTH_SERVICE_UNAVAILABLE');

    spy.mockRestore();
  });

  it('14. healthy Redis behavior remains unchanged for Socket.IO (connects successfully)', async () => {
    const client = createClient(otherAccessToken);

    const result = await new Promise<string>((resolve) => {
      client.on('connect', () => resolve('CONNECTED'));
      client.on('connect_error', (err) => resolve(err.message));
    });

    expect(result).toBe('CONNECTED');
    expect(client.connected).toBe(true);
  });
});
