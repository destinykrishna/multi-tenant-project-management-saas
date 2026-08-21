import request from 'supertest';
import { app } from '../../src/app.js';
import { redis, checkRedisHealth } from '../../src/config/redis.js';

describe('Health Check & Redis Infrastructure Tests', () => {
  describe('GET /health', () => {
    it('should return health status including redis service details (200)', async () => {
      const res = await request(app).get('/health').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBeDefined();
      expect(res.body.data.timestamp).toBeDefined();
      expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body.data.environment).toBeDefined();
      expect(res.body.data.services).toBeDefined();
      expect(res.body.data.services.redis).toBeDefined();
      expect(['healthy', 'unhealthy']).toContain(res.body.data.services.redis.status);
    });
  });

  describe('Redis Singleton & Health Helper', () => {
    it('should provide a single reusable Redis client', () => {
      expect(redis).toBeDefined();
      expect(typeof redis.ping).toBe('function');
    });

    it('should report redis health with checkRedisHealth helper', async () => {
      const health = await checkRedisHealth();

      expect(health).toBeDefined();
      expect(['healthy', 'unhealthy']).toContain(health.status);

      if (health.status === 'healthy') {
        expect(typeof health.latencyMs).toBe('number');
      } else {
        expect(typeof health.error).toBe('string');
      }
    });
  });
});
