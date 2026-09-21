import { Router } from 'express';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { authRateLimiter } from '../../middlewares/rate-limit.middleware.js';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  verifyTotpSchema,
  mfaLoginSchema,
  invitationTokenParamSchema,
  acceptInvitationSchema,
} from './auth.schema.js';
import { authController } from './auth.controller.js';

const router = Router();

// ─── Workspace Invitations ─────────────────────────────────────────────────────
router.get(
  '/invitations/:token',
  authRateLimiter,
  validateRequest({ params: invitationTokenParamSchema }),
  authController.getInvitation,
);

router.post(
  '/invitations/accept',
  authRateLimiter,
  optionalAuthenticate,
  validateRequest({ body: acceptInvitationSchema }),
  authController.acceptInvitation,
);

router.post(
  '/register',
  authRateLimiter,
  validateRequest({ body: registerSchema }),
  authController.register,
);

router.post(
  '/login',
  authRateLimiter,
  validateRequest({ body: loginSchema }),
  authController.login,
);

router.post('/refresh', authRateLimiter, authController.refresh);
router.post('/logout', authController.logout);

router.post(
  '/change-password',
  authenticate,
  authRateLimiter,
  validateRequest({ body: changePasswordSchema }),
  authController.changePassword,
);

// ─── Two-Factor Authentication (TOTP) ──────────────────────────────────────────
router.post('/2fa/setup', authenticate, authRateLimiter, authController.setup2fa);

router.post(
  '/2fa/verify',
  authenticate,
  authRateLimiter,
  validateRequest({ body: verifyTotpSchema }),
  authController.verify2fa,
);

router.post(
  '/2fa/disable',
  authenticate,
  authRateLimiter,
  validateRequest({ body: verifyTotpSchema }),
  authController.disable2fa,
);

router.post(
  '/2fa/login',
  authRateLimiter,
  validateRequest({ body: mfaLoginSchema }),
  authController.mfaLogin,
);

export const authRouter = router;
