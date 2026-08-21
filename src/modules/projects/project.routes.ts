import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { OrganizationRole } from '../../constants/roles.js';
import {
  createProjectSchema,
  updateProjectSchema,
  projectOrgParamSchema,
  projectParamSchema,
  listProjectsQuerySchema,
} from './project.schema.js';
import { projectController } from './project.controller.js';

const router = Router({ mergeParams: true });

// All project routes require authentication
router.use(authenticate);

// Create project (OWNER, ADMIN, MEMBER)
router.post(
  '/',
  validateRequest({
    params: projectOrgParamSchema,
    body: createProjectSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  projectController.create,
);

// List projects with pagination & filters (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/',
  validateRequest({
    params: projectOrgParamSchema,
    query: listProjectsQuerySchema,
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
  projectController.list,
);

// Get project by ID (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/:projectId',
  validateRequest({
    params: projectParamSchema,
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
  projectController.getById,
);

// Update project (OWNER, ADMIN, MEMBER)
router.patch(
  '/:projectId',
  validateRequest({
    params: projectParamSchema,
    body: updateProjectSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  projectController.update,
);

// Delete project (OWNER, ADMIN only)
router.delete(
  '/:projectId',
  validateRequest({
    params: projectParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], {
    orgIdParam: 'organizationId',
  }),
  projectController.delete,
);

export const projectRouter = router;
