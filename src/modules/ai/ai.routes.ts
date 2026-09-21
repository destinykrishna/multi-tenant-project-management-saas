import { Router } from 'express';
import { ALL_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { aiRateLimiter } from '../../middlewares/rate-limit.middleware.js';
import { aiController } from './ai.controller.js';
import { agentOrgParamSchema, agentRunRequestSchema } from './ai.schema.js';

const router = Router({ mergeParams: true });

// All AI routes require authentication and AI-specific rate limiting
router.use(authenticate);
router.use(aiRateLimiter);

// Run AI Agent (All org members)
router.post(
  '/agent',
  validateRequest({
    params: agentOrgParamSchema,
    body: agentRunRequestSchema,
  }),
  authorizeOrgRole(ALL_ROLES, {
    orgIdParam: 'organizationId',
  }),
  aiController.runAgent,
);

export const aiRouter = router;
