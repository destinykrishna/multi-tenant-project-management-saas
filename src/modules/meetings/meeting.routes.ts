import { Router } from 'express';
import { OrganizationRole, ALL_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { meetingController } from './meeting.controller.js';
import {
  createMeetingSchema,
  updateMeetingSchema,
  listMeetingsQuerySchema,
  meetingOrgParamSchema,
  meetingParamSchema,
} from './meeting.schema.js';

const router = Router({ mergeParams: true });

// All meeting routes require authentication
router.use(authenticate);

router.post(
  '/',
  validateRequest({
    params: meetingOrgParamSchema,
    body: createMeetingSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  meetingController.create,
);

router.get(
  '/',
  validateRequest({
    params: meetingOrgParamSchema,
    query: listMeetingsQuerySchema,
  }),
  authorizeOrgRole(ALL_ROLES, {
    orgIdParam: 'organizationId',
  }),
  meetingController.list,
);

router.get(
  '/:meetingId',
  validateRequest({
    params: meetingParamSchema,
  }),
  authorizeOrgRole(ALL_ROLES, {
    orgIdParam: 'organizationId',
  }),
  meetingController.getById,
);

router.patch(
  '/:meetingId',
  validateRequest({
    params: meetingParamSchema,
    body: updateMeetingSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  meetingController.update,
);

router.delete(
  '/:meetingId',
  validateRequest({
    params: meetingParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  meetingController.delete,
);

router.post(
  '/:meetingId/meet',
  validateRequest({
    params: meetingParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  meetingController.generateMeetLink,
);

export const meetingRouter = router;
