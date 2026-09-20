import type { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { sendError } from '../utils/response.js';

export interface RateLimiterOptions {
  windowSeconds: number;
  maxRequests: number;
  prefix?: string;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  message?: string;
  code?: string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const {
    windowSeconds,
    maxRequests,
    prefix = 'rl',
    keyGenerator = (req: Request) => req.ip ?? '127.0.0.1',
    skip,
    message = 'Too many requests, please try again later',
    code = 'RATE_LIMIT_EXCEEDED',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (skip && skip(req)) {
      next();
      return;
    }

    try {
      const identifier = keyGenerator(req);
      const key = `ratelimit:${prefix}:${identifier}`;

      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);

      const results = await pipeline.exec();

      if (!results || results.length < 2) {
        next();
        return;
      }

      const [incrErr, currentCountRaw] = results[0] as [Error | null, unknown];
      const [ttlErr, currentTtlRaw] = results[1] as [Error | null, unknown];

      if (incrErr || ttlErr) {
        logger.warn(
          { error: incrErr ?? ttlErr, key },
          'Redis rate limit error, bypassing rate limiter',
        );
        next();
        return;
      }

      const currentCount = typeof currentCountRaw === 'number' ? currentCountRaw : 1;
      const currentTtl = typeof currentTtlRaw === 'number' ? currentTtlRaw : -1;

      // If key is new (TTL is -1), set the expiration window
      if (currentTtl === -1) {
        await redis.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, maxRequests - currentCount);
      const resetSeconds = currentTtl > 0 ? currentTtl : windowSeconds;

      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', resetSeconds.toString());

      if (currentCount > maxRequests) {
        res.setHeader('Retry-After', resetSeconds.toString());
        sendError(res, 429, code, message, {
          retryAfter: resetSeconds,
          limit: maxRequests,
          windowSeconds,
        });
        return;
      }

      next();
    } catch (error) {
      logger.warn(
        { error, path: req.path },
        'Unexpected rate limit failure, allowing request through',
      );
      next();
    }
  };
}

// ─── Predefined Rate Limiters ──────────────────────────────────────────────────

// General API rate limiter (200 requests / minute, higher in tests to prevent suite starvation)
export const generalRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: process.env['NODE_ENV'] === 'test' ? 50000 : 200,
  prefix: 'gen',
  skip: (req) => process.env['NODE_ENV'] !== 'production' && req.headers['x-load-test'] === 'true',
  message: 'API rate limit exceeded, please slow down your requests',
  code: 'API_RATE_LIMIT_EXCEEDED',
});

// Stricter rate limiter for sensitive authentication operations (20 requests / 15 minutes)
export const authRateLimiter = createRateLimiter({
  windowSeconds: 15 * 60,
  maxRequests: process.env['NODE_ENV'] === 'test' ? 50000 : 20,
  prefix: 'auth',
  keyGenerator: (req: Request) => {
    const ip = req.ip ?? '127.0.0.1';
    const email =
      typeof req.body === 'object' && req.body !== null && 'email' in req.body
        ? String((req.body as { email: unknown }).email)
            .toLowerCase()
            .trim()
        : '';
    return email ? `${ip}:${email}` : ip;
  },
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
  code: 'AUTH_RATE_LIMIT_EXCEEDED',
});

// Dedicated rate limiter for AI agent execution (30 requests / minute per user & organization key)
export const aiRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: process.env['NODE_ENV'] === 'test' ? 5000 : 30,
  prefix: 'ai',
  keyGenerator: (req: Request) => {
    const userId = req.user?.id ?? req.ip ?? '127.0.0.1';
    const orgId = (req.params as Record<string, string>)['organizationId'] ?? 'global';
    return `${orgId}:${userId}`;
  },
  message: 'AI agent request rate limit exceeded. Please wait a moment before sending more queries.',
  code: 'AI_RATE_LIMIT_EXCEEDED',
});

