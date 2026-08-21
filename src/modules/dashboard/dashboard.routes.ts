import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireOrgMember } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { dashboardParamsSchema, getDashboardQuerySchema } from './dashboard.schema.js';
import { dashboardController } from './dashboard.controller.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  authenticate,
  validateRequest({
    params: dashboardParamsSchema,
    query: getDashboardQuerySchema,
  }),
  requireOrgMember({ orgIdParam: 'organizationId' }),
  dashboardController.getDashboard,
);

export const dashboardRouter = router;
