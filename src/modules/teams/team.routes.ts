import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { OrganizationRole } from '../../constants/roles.js';
import {
  createTeamSchema,
  updateTeamSchema,
  orgParamSchema,
  teamParamSchema,
} from './team.schema.js';
import { teamController } from './team.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate);

// List teams in organization (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/',
  validateRequest({
    params: orgParamSchema,
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
  teamController.list,
);

// Get team by ID (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/:teamId',
  validateRequest({
    params: teamParamSchema,
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
  teamController.getById,
);

// Create team (OWNER, ADMIN, MEMBER)
router.post(
  '/',
  validateRequest({
    params: orgParamSchema,
    body: createTeamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  teamController.create,
);

// Update team (OWNER, ADMIN)
router.patch(
  '/:teamId',
  validateRequest({
    params: teamParamSchema,
    body: updateTeamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], {
    orgIdParam: 'organizationId',
  }),
  teamController.update,
);

// Delete team (OWNER, ADMIN)
router.delete(
  '/:teamId',
  validateRequest({
    params: teamParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], {
    orgIdParam: 'organizationId',
  }),
  teamController.delete,
);

export const teamRouter = router;
