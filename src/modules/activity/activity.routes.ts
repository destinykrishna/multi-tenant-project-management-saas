import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { OrganizationRole } from '../../constants/roles.js';
import {
  activityOrgParamSchema,
  activityEntityParamSchema,
  listActivityQuerySchema,
  listEntityActivityQuerySchema,
} from './activity.schema.js';
import { activityController } from './activity.controller.js';

const router = Router({ mergeParams: true });

// All activity routes require authentication
router.use(authenticate);

// List organization activity (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/',
  validateRequest({
    params: activityOrgParamSchema,
    query: listActivityQuerySchema,
  }),
  authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ],
    { orgIdParam: 'organizationId' },
  ),
  activityController.list,
);

// List entity-specific activity (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/:entityType/:entityId',
  validateRequest({
    params: activityEntityParamSchema,
    query: listEntityActivityQuerySchema,
  }),
  authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ],
    { orgIdParam: 'organizationId' },
  ),
  activityController.listByEntity,
);

// Verify audit trail cryptographic integrity (OWNER, ADMIN only)
router.get(
  '/audit/verify-integrity',
  validateRequest({
    params: activityOrgParamSchema,
  }),
  authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
    ],
    { orgIdParam: 'organizationId' },
  ),
  activityController.verifyIntegrity,
);

export const activityRouter = router;

