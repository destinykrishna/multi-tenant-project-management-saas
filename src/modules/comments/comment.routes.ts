import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { OrganizationRole } from '../../constants/roles.js';
import {
  createCommentSchema,
  updateCommentSchema,
  commentTaskParamSchema,
  commentParamSchema,
  listCommentsQuerySchema,
} from './comment.schema.js';
import { commentController } from './comment.controller.js';

const router = Router({ mergeParams: true });

// All comment routes require authentication
router.use(authenticate);

// Create comment (OWNER, ADMIN, MEMBER)
router.post(
  '/',
  validateRequest({
    params: commentTaskParamSchema,
    body: createCommentSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  commentController.create,
);

// List comments with pagination (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/',
  validateRequest({
    params: commentTaskParamSchema,
    query: listCommentsQuerySchema,
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
  commentController.list,
);

// Update comment (OWNER, ADMIN, MEMBER - author checked in service)
router.patch(
  '/:commentId',
  validateRequest({
    params: commentParamSchema,
    body: updateCommentSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  commentController.update,
);

// Delete comment (OWNER, ADMIN, MEMBER - author or moderator checked in service)
router.delete(
  '/:commentId',
  validateRequest({
    params: commentParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  commentController.delete,
);

export const commentRouter = router;
