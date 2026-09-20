import request from 'supertest';
import { app } from '../../src/app.js';
import { disconnectDatabase } from '../../src/config/database.js';

describe('Cloudflare CDN & Edge Security Integration Tests', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('GET /api/v1/system/edge-status - should return Cloudflare and Nginx reverse proxy telemetry', async () => {
    const res = await request(app)
      .get('/api/v1/system/edge-status')
      .set('cf-ray', '8f12a4b89c01ad-DEL')
      .set('cf-connecting-ip', '203.0.113.42')
      .set('cf-ipcountry', 'IN')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.headers['cf-ray']).toBe('8f12a4b89c01ad-DEL');
    expect(res.headers['x-edge-country']).toBe('IN');

    // Telemetry payload validation
    const { cloudflare, nginx, server } = res.body.data;
    expect(cloudflare).toBeDefined();
    expect(cloudflare.isEdgeDetected).toBe(true);
    expect(cloudflare.rayId).toBe('8f12a4b89c01ad-DEL');
    expect(cloudflare.clientIp).toBe('203.0.113.42');
    expect(cloudflare.country).toBe('IN');
    expect(cloudflare.wafStatus).toContain('ACTIVE');

    expect(nginx).toBeDefined();
    expect(nginx.reverseProxy).toBe('ACTIVE');
    expect(nginx.loadBalancingStrategy).toContain('least_conn');
    expect(nginx.upstreamInstances).toContain('api_1:5000');

    expect(server).toBeDefined();
    expect(server.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('POST /api/v1/system/edge-cache/purge - should execute edge cache purge signal', async () => {
    // 1. Create authenticated session or register
    const regRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Edge Admin',
      email: `edge.admin.${Date.now()}@example.com`,
      password: 'SecureEdgePassword123!',
      organizationName: 'Edge CDN Org',
    });
    const token = regRes.body.data.accessToken;

    const res = await request(app)
      .post('/api/v1/system/edge-cache/purge')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toContain('purge');
  });

  it('POST /api/v1/system/turnstile/verify - should verify turnstile token', async () => {
    const res = await request(app)
      .post('/api/v1/system/turnstile/verify')
      .send({ token: 'mock-cf-turnstile-token' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(true);
  });
});
