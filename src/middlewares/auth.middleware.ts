import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/jwt.js';

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
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
    req.user = {
      id: payload.userId,
      email: payload.email,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Access token has expired', 'TOKEN_EXPIRED'));
      return;
    }
    next(new UnauthorizedError('Invalid access token', 'INVALID_ACCESS_TOKEN'));
  }
}
