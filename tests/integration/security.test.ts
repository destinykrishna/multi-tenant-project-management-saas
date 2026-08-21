import request from 'supertest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { app } from '../../src/app.js';
import { redis } from '../../src/config/redis.js';
import { disconnectDatabase } from '../../src/config/database.js';
import { createRateLimiter } from '../../src/middlewares/rate-limit.middleware.js';

describe('API Security & Rate Limiting Integration Tests', () => {
  afterAll(async () => {
    // Clean up test rate limit keys
    const keys = await redis.keys('ratelimit:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await disconnectDatabase();
    redis.disconnect();
  });

  describe('Security Headers & CORS Configuration', () => {
    it('should include Helmet security headers on responses', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
    });

    it('should not expose server details in headers', async () => {
      const response = await request(app).get('/health');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('Rate Limiter Behavior', () => {
    let testApp: express.Application;

    beforeEach(() => {
      testApp = express();
      testApp.use(express.json());
    });

    it('should set appropriate rate limit headers on allowed requests', async () => {
      const limiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 5,
        prefix: `test-${randomUUID()}`,
      });

      testApp.get('/test-limit', limiter, (_req, res) => {
        res.json({ success: true });
      });

      const response = await request(testApp).get('/test-limit');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('5');
      expect(response.headers['x-ratelimit-remaining']).toBe('4');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should return 429 when rate limit threshold is exceeded', async () => {
      const prefix = `exceed-${randomUUID()}`;
      const limiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 2,
        prefix,
        message: 'Custom rate limit exceeded',
        code: 'CUSTOM_RATE_LIMIT',
      });

      testApp.get('/limited', limiter, (_req, res) => {
        res.json({ success: true });
      });

      // 1st request - ok
      const res1 = await request(testApp).get('/limited');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-ratelimit-remaining']).toBe('1');

      // 2nd request - ok
      const res2 = await request(testApp).get('/limited');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-ratelimit-remaining']).toBe('0');

      // 3rd request - blocked with 429
      const res3 = await request(testApp).get('/limited');
      expect(res3.status).toBe(429);
      expect(res3.body.success).toBe(false);
      expect(res3.body.error.code).toBe('CUSTOM_RATE_LIMIT');
      expect(res3.headers['retry-after']).toBeDefined();
    });

    it('should isolate rate limits across different IP addresses or identifiers', async () => {
      const prefix = `iso-${randomUUID()}`;
      const limiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 1,
        prefix,
        keyGenerator: (req) => (req.headers['x-test-ip'] as string) || '127.0.0.1',
      });

      testApp.get('/ip-test', limiter, (_req, res) => {
        res.json({ success: true });
      });

      // User 1 consumes their limit
      const res1 = await request(testApp).get('/ip-test').set('x-test-ip', '192.168.1.1');
      expect(res1.status).toBe(200);

      const res1Blocked = await request(testApp).get('/ip-test').set('x-test-ip', '192.168.1.1');
      expect(res1Blocked.status).toBe(429);

      // User 2 has their own separate limit intact
      const res2 = await request(testApp).get('/ip-test').set('x-test-ip', '192.168.1.2');
      expect(res2.status).toBe(200);
    });

    it('should gracefully allow requests through if Redis encounters errors', async () => {
      const pipelineSpy = jest.spyOn(redis, 'pipeline').mockReturnValueOnce({
        incr: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValueOnce(new Error('Redis connection failed')),
      } as unknown as ReturnType<typeof redis.pipeline>);

      const limiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 1,
        prefix: `fallback-${randomUUID()}`,
      });

      testApp.get('/fallback-test', limiter, (_req, res) => {
        res.json({ success: true, fromFallback: true });
      });

      const response = await request(testApp).get('/fallback-test');

      expect(response.status).toBe(200);
      expect(response.body.fromFallback).toBe(true);

      pipelineSpy.mockRestore();
    });
  });

  describe('Health Endpoint Rate Limit Exemption', () => {
    it('should not rate limit the health check endpoint', async () => {
      // Rapid fire 10 health check requests
      for (let i = 0; i < 10; i++) {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
      }
    });
  });
});
