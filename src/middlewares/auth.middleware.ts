import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError, ServiceUnavailableError, AppError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { tokenRevocationBloom } from '../utils/bloom.js';
import { logger } from '../config/logger.js';

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    jti?: string;
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next(new UnauthorizedError('Authorization header is required', 'AUTH_HEADER_REQUIRED'));
    return;
  }

  const trimmed = authHeader.trim();
  const [scheme, token] = trimmed.split(/\s+/);

  if (scheme !== 'Bearer' || !token) {
    next(
      new UnauthorizedError(
        'Malformed authorization header. Expected "Bearer <token>"',
        'MALFORMED_AUTH_HEADER',
      ),
    );
    return;
  }

  try {
    const payload = verifyAccessToken(token);

    // Distributed Redis revocation check (authoritative, survives restart, fails closed)
    if (payload.jti && (await tokenRevocationBloom.isRevokedDistributed(payload.jti))) {
      next(new UnauthorizedError('Token has been revoked', 'TOKEN_REVOKED'));
      return;
    }

    req.user = {
      id: payload.userId,
      email: payload.email,
    };
    req.jti = payload.jti;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Access token has expired', 'TOKEN_EXPIRED'));
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid access token', 'INVALID_ACCESS_TOKEN'));
      return;
    }
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error({ error }, 'Authentication failed: token revocation service unavailable');
    next(
      new ServiceUnavailableError(
        'Authentication service temporarily unavailable',
        'AUTH_SERVICE_UNAVAILABLE',
      ),
    );
  }
}

export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    next();
    return;
  }

  const trimmed = authHeader.trim();
  const [scheme, token] = trimmed.split(/\s+/);
  if (scheme !== 'Bearer' || !token) {
    next();
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.jti && (await tokenRevocationBloom.isRevokedDistributed(payload.jti))) {
      next();
      return;
    }
    req.user = {
      id: payload.userId,
      email: payload.email,
    };
    req.jti = payload.jti;
    next();
  } catch {
    next();
  }
}
