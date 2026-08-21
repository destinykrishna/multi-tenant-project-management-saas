import { Router } from 'express';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { authRateLimiter } from '../../middlewares/rate-limit.middleware.js';
import { registerSchema, loginSchema } from './auth.schema.js';
import { authController } from './auth.controller.js';

const router = Router();

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

export const authRouter = router;
