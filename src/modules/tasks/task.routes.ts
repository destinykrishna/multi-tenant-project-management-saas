import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { OrganizationRole } from '../../constants/roles.js';
import {
  createTaskSchema,
  updateTaskSchema,
  taskProjectParamSchema,
  taskParamSchema,
  listTasksQuerySchema,
} from './task.schema.js';
import { taskController } from './task.controller.js';

const router = Router({ mergeParams: true });

// All task routes require authentication
router.use(authenticate);

// Create task (OWNER, ADMIN, MEMBER)
router.post(
  '/',
  validateRequest({
    params: taskProjectParamSchema,
    body: createTaskSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  taskController.create,
);

// List tasks with pagination, filters & sorting (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/',
  validateRequest({
    params: taskProjectParamSchema,
    query: listTasksQuerySchema,
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
  taskController.list,
);

// Get task by ID (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/:taskId',
  validateRequest({
    params: taskParamSchema,
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
  taskController.getById,
);

// Update task (OWNER, ADMIN, MEMBER)
router.patch(
  '/:taskId',
  validateRequest({
    params: taskParamSchema,
    body: updateTaskSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  taskController.update,
);

// Delete task (OWNER, ADMIN only)
router.delete(
  '/:taskId',
  validateRequest({
    params: taskParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], {
    orgIdParam: 'organizationId',
  }),
  taskController.delete,
);

export const taskRouter = router;
