import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { authService, type AuthService } from './auth.service.js';
import { organizationService } from '../organizations/organization.service.js';
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  VerifyTotpInput,
  MfaLoginInput,
} from './auth.schema.js';

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

      if (result.requiresMfa) {
        sendSuccess(
          res,
          {
            requiresMfa: true,
            mfaToken: result.mfaToken,
          },
          200,
          'Two-factor authentication code required',
        );
        return;
      }

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

      await this.service.logout(rawRefreshToken, req.jti);

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

  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = req.body as ChangePasswordInput;
      const userId = req.user?.id;

      if (!userId) {
        throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');
      }

      const result = await this.service.changePassword(userId, input, req.jti);
      sendSuccess(res, result, 200, 'Password updated successfully');
    } catch (error) {
      next(error);
    }
  };

  setup2fa = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');

      const result = await this.service.setup2fa(userId);
      sendSuccess(res, result, 200, 'Two-factor authentication secret generated');
    } catch (error) {
      next(error);
    }
  };

  verify2fa = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');

      const { code } = req.body as VerifyTotpInput;
      const result = await this.service.verifyAndEnable2fa(userId, code);
      sendSuccess(res, result, 200, result.message);
    } catch (error) {
      next(error);
    }
  };

  disable2fa = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');

      const { code } = req.body as VerifyTotpInput;
      const result = await this.service.disable2fa(userId, code);
      sendSuccess(res, result, 200, result.message);
    } catch (error) {
      next(error);
    }
  };

  mfaLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mfaToken, code } = req.body as MfaLoginInput;
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await this.service.verifyMfaLogin(mfaToken, code, {
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
        'Two-factor authentication successful',
      );
    } catch (error) {
      next(error);
    }
  };

  getInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.params['token'] as string;
      const invitation = await organizationService.getInvitationByToken(token);
      sendSuccess(res, invitation, 200, 'Invitation retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  acceptInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, name, password } = req.body;
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await organizationService.acceptInvitation(
        token,
        { name, password },
        { userAgent, ipAddress },
      );

      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: REFRESH_COOKIE_MAX_AGE_MS,
      });

      sendSuccess(
        res,
        {
          accessToken: result.tokens.accessToken,
          user: result.user,
          organization: result.organization,
        },
        200,
        'Invitation accepted successfully',
      );
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
