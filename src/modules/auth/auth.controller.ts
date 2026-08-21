import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { authService, type AuthService } from './auth.service.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class AuthController {
  constructor(private readonly service: AuthService = authService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = req.body as RegisterInput;
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await this.service.register(input, {
        userAgent,
        ipAddress,
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: REFRESH_COOKIE_MAX_AGE_MS,
      });

      sendSuccess(
        res,
        {
          accessToken: result.accessToken,
          user: result.user,
          organization: result.organization,
        },
        201,
        'User registered successfully',
      );
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = req.body as LoginInput;
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await this.service.login(input, {
        userAgent,
        ipAddress,
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: REFRESH_COOKIE_MAX_AGE_MS,
      });

      sendSuccess(
        res,
        {
          accessToken: result.accessToken,
          user: result.user,
        },
        200,
        'Login successful',
      );
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawRefreshToken = (req.cookies as Record<string, string> | undefined)?.['refreshToken'];

      if (!rawRefreshToken) {
        throw new UnauthorizedError('Refresh token is required', 'REFRESH_TOKEN_REQUIRED');
      }

      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await this.service.refresh(rawRefreshToken, {
        userAgent,
        ipAddress,
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: REFRESH_COOKIE_MAX_AGE_MS,
      });

      sendSuccess(
        res,
        {
          accessToken: result.accessToken,
          user: result.user,
        },
        200,
        'Token refreshed successfully',
      );
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawRefreshToken = (req.cookies as Record<string, string> | undefined)?.['refreshToken'];

      await this.service.logout(rawRefreshToken);

      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
      });

      sendSuccess(res, null, 200, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
