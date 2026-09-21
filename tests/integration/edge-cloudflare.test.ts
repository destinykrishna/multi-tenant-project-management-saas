import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { createRateLimiter } from '../../src/middlewares/rate-limit.middleware.js';
import { cloudflareEdgeMiddleware, isTrustedProxy } from '../../src/middlewares/cloudflare.middleware.js';
import express from 'express';

describe('Cloudflare CDN, Edge Security & Purge Authorization Tests', () => {
  const TEST_PLATFORM_SECRET = 'test-platform-secret';
  let ownerUser: { id: string; email: string; token: string };
  let adminUser: { id: string; email: string; token: string };
  let ordinaryUser: { id: string; email: string; token: string };
  let orgId: string;

  beforeAll(async () => {
    // 1. Create test users
    const [uOwner, uAdmin, uMember] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Edge Owner',
          email: `edge.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Edge Admin Member',
          email: `edge.admin.member.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Edge Normal Member',
          email: `edge.member.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
    ]);

    ownerUser = {
      id: uOwner.id,
      email: uOwner.email,
      token: generateAccessToken({ userId: uOwner.id, email: uOwner.email }),
    };

    adminUser = {
      id: uAdmin.id,
      email: uAdmin.email,
      token: generateAccessToken({ userId: uAdmin.id, email: uAdmin.email }),
    };

    ordinaryUser = {
      id: uMember.id,
      email: uMember.email,
      token: generateAccessToken({ userId: uMember.id, email: uMember.email }),
    };

    // 2. Organization & Memberships
    const org = await prisma.organization.create({
      data: {
        name: 'Edge CDN Test Org',
        slug: `edge-cdn-org-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    orgId = org.id;

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgId, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: orgId, userId: adminUser.id, role: 'ADMIN' },
        { organizationId: orgId, userId: ordinaryUser.id, role: 'MEMBER' },
      ],
    });
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    const userIds = [ownerUser?.id, adminUser?.id, ordinaryUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await disconnectDatabase();
  });

  describe('EDGE CACHE PURGE AUTHORIZATION', () => {
    it('should reject edge cache purge for unauthenticated request without platform secret (403)', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('should reject edge cache purge for ordinary authenticated user (403)', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('Authorization', `Bearer ${ordinaryUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('should reject edge cache purge for organization ADMIN without platform secret (403)', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('should reject edge cache purge for organization OWNER without platform secret (403)', async () => {
      // Organization OWNER does NOT grant global CDN edge purge privileges
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('should reject edge cache purge with invalid platform secret (403)', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .set('x-platform-secret', 'wrong-platform-secret-xyz')
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PLATFORM_SECRET');
    });

    it('should allow edge cache purge for organization OWNER when providing valid platform secret (200)', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .set('x-platform-secret', TEST_PLATFORM_SECRET)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.message).toContain('purge');
    });

    it('should allow edge cache purge for authorized system caller via x-platform-secret without user JWT (200)', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('x-platform-secret', TEST_PLATFORM_SECRET)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('purge');
    });

    it('should allow edge cache purge for authorized system caller via Authorization Bearer secret (200)', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('Authorization', `Bearer ${TEST_PLATFORM_SECRET}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('purge');
    });

    it('should never expose Cloudflare credentials, API token, Zone ID, or secrets in purge response or headers', async () => {
      const res = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('x-platform-secret', TEST_PLATFORM_SECRET)
        .expect(200);

      const responseString = JSON.stringify(res.body);
      expect(responseString).not.toContain('CLOUDFLARE_API_TOKEN');
      expect(responseString).not.toContain('CLOUDFLARE_ZONE_ID');
      expect(responseString).not.toContain(TEST_PLATFORM_SECRET);
      expect(res.headers['x-platform-secret']).toBeUndefined();
    });
  });

  describe('TRUSTED CLIENT IP & CLOUDFLARE SPOOFING DEFENSE', () => {
    it('should NOT accept spoofed CF-Connecting-IP from an untrusted direct client', async () => {
      const untrustedClientIp = '198.51.100.77';
      const spoofedIp = '1.1.1.1';

      const res = await request(app)
        .get('/api/v1/system/edge-status')
        .set('x-test-remote-addr', untrustedClientIp)
        .set('cf-connecting-ip', spoofedIp)
        .set('cf-ray', 'spoofed-ray-id-DEL')
        .expect(200);

      expect(res.body.success).toBe(true);
      const { cloudflare } = res.body.data;
      // Client IP must be the actual direct connection IP, NOT the spoofed header
      expect(cloudflare.clientIp).toBe(untrustedClientIp);
      expect(cloudflare.isEdgeDetected).toBe(false);
      expect(cloudflare.rayId).not.toBe('spoofed-ray-id-DEL');
      expect(res.headers['cf-ray']).not.toBe('spoofed-ray-id-DEL');
    });

    it('should NOT blindly trust spoofed X-Forwarded-For from an untrusted direct client', async () => {
      const untrustedClientIp = '198.51.100.88';
      const spoofedXff = '203.0.113.199, 10.0.0.1';

      const res = await request(app)
        .get('/api/v1/system/edge-status')
        .set('x-test-remote-addr', untrustedClientIp)
        .set('x-forwarded-for', spoofedXff)
        .expect(200);

      expect(res.body.success).toBe(true);
      const { cloudflare } = res.body.data;
      expect(cloudflare.clientIp).toBe(untrustedClientIp);
      expect(cloudflare.isEdgeDetected).toBe(false);
    });

    it('should correctly resolve CF-Connecting-IP when request actually arrives through trusted proxy boundary', async () => {
      // Direct connection is from loopback / trusted proxy (127.0.0.1)
      const trustedClientIp = '203.0.113.42';
      const genuineRayId = '8f12a4b89c01ad-DEL';

      const res = await request(app)
        .get('/api/v1/system/edge-status')
        .set('cf-connecting-ip', trustedClientIp)
        .set('cf-ray', genuineRayId)
        .set('cf-ipcountry', 'IN')
        .expect(200);

      expect(res.body.success).toBe(true);
      const { cloudflare } = res.body.data;
      expect(cloudflare.clientIp).toBe(trustedClientIp);
      expect(cloudflare.isEdgeDetected).toBe(true);
      expect(cloudflare.rayId).toBe(genuineRayId);
      expect(res.headers['cf-ray']).toBe(genuineRayId);
      expect(res.headers['x-edge-country']).toBe('IN');
    });

    it('should correctly resolve X-Forwarded-For when request arrives through trusted proxy boundary without CF-Connecting-IP', async () => {
      const forwardedClientIp = '192.0.2.123';

      const res = await request(app)
        .get('/api/v1/system/edge-status')
        .set('x-forwarded-for', forwardedClientIp)
        .expect(200);

      expect(res.body.success).toBe(true);
      const { cloudflare } = res.body.data;
      expect(cloudflare.clientIp).toBe(forwardedClientIp);
    });

    it('should use the resolved client IP for rate limiting and prevent spoofing bypass', async () => {
      // Test dedicated app instance with low rate limit threshold (2 requests / window)
      const testApp = express();
      testApp.set('trust proxy', isTrustedProxy);
      testApp.use(cloudflareEdgeMiddleware);
      const testLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 2,
        prefix: `spoof-test-${Date.now()}`,
        skip: () => false, // do not skip in test
      });

      testApp.use(testLimiter);
      testApp.get('/test-rl', (_req, res) => {
        res.json({ success: true });
      });

      const untrustedPeer = '198.51.100.95';

      // Request 1: attacker claims spoofed IP 1.1.1.1
      const res1 = await request(testApp)
        .get('/test-rl')
        .set('x-test-remote-addr', untrustedPeer)
        .set('cf-connecting-ip', '1.1.1.1')
        .expect(200);
      expect(res1.body.success).toBe(true);

      // Request 2: attacker claims spoofed IP 2.2.2.2 to try to bypass rate limit
      const res2 = await request(testApp)
        .get('/test-rl')
        .set('x-test-remote-addr', untrustedPeer)
        .set('cf-connecting-ip', '2.2.2.2')
        .expect(200);
      expect(res2.body.success).toBe(true);

      // Request 3: exceeds limit of 2 requests from untrustedPeer despite rotating spoofed headers
      const res3 = await request(testApp)
        .get('/test-rl')
        .set('x-test-remote-addr', untrustedPeer)
        .set('cf-connecting-ip', '3.3.3.3')
        .expect(429);

      expect(res3.body.success).toBe(false);
      expect(res3.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('TURNSTILE VERIFICATION', () => {
    it('POST /api/v1/system/turnstile/verify - should verify turnstile token', async () => {
      const res = await request(app)
        .post('/api/v1/system/turnstile/verify')
        .send({ token: 'mock-cf-turnstile-token' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.verified).toBe(true);
    });
  });
});
