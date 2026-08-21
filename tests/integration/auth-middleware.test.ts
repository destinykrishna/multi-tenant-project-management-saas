import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../src/middlewares/auth.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

describe('Authentication Middleware (authenticate)', () => {
  const app = express();
  app.use(express.json());

  // Protected dummy route for testing
  app.get('/protected', authenticate, (req, res) => {
    res.json({
      success: true,
      user: req.user,
    });
  });

  app.use(errorHandler);

  it('should reject requests without an Authorization header (401)', async () => {
    const response = await request(app).get('/protected').expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('AUTH_HEADER_REQUIRED');
  });

  it('should reject requests with malformed Authorization header (401)', async () => {
    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Basic abcdef123')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('MALFORMED_AUTH_HEADER');
  });

  it('should reject requests with Bearer prefix but empty token (401)', async () => {
    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('MALFORMED_AUTH_HEADER');
  });

  it('should reject invalid/tampered tokens (401)', async () => {
    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer invalid.token.value')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('should reject expired tokens (401)', async () => {
    // Generate expired token (-1 second)
    const expiredToken = jwt.sign(
      { userId: 'user-123', email: 'user@example.com' },
      env.JWT_SECRET,
      { expiresIn: '-1s' },
    );

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('should accept valid tokens and attach user context to req.user (200)', async () => {
    const validToken = generateAccessToken({
      userId: 'user-uuid-123',
      email: 'verified@example.com',
    });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.user).toEqual({
      id: 'user-uuid-123',
      email: 'verified@example.com',
    });
  });
});
