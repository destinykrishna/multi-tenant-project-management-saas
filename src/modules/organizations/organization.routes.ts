import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { OrganizationRole } from '../../constants/roles.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationIdParamSchema,
  organizationMemberParamSchema,
  organizationInvitationParamSchema,
  addMemberSchema,
  updateMemberRoleSchema,
} from './organization.schema.js';
import { organizationController } from './organization.controller.js';

const router = Router();

// All organization routes require authentication
router.use(authenticate);

// ─── Organization CRUD ──────────────────────────────────────────────────────────

// Create a new organization (authenticated user becomes OWNER)
router.post(
  '/',
  validateRequest({ body: createOrganizationSchema }),
  organizationController.create,
);

// List all organizations the authenticated user belongs to
router.get('/', organizationController.list);

// Get organization by ID (members only: OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/:id',
  validateRequest({ params: organizationIdParamSchema }),
  authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ],
    { orgIdParam: 'id' },
  ),
  organizationController.getById,
);

// Update organization (OWNER, ADMIN only)
router.patch(
  '/:id',
  validateRequest({ params: organizationIdParamSchema, body: updateOrganizationSchema }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], { orgIdParam: 'id' }),
  organizationController.update,
);

// Delete organization (OWNER only)
router.delete(
  '/:id',
  validateRequest({ params: organizationIdParamSchema }),
  authorizeOrgRole([OrganizationRole.OWNER], { orgIdParam: 'id' }),
  organizationController.delete,
);

// ─── Member Management ──────────────────────────────────────────────────────────

// List members of an organization (all members: OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/:id/members',
  validateRequest({ params: organizationIdParamSchema }),
  authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ],
    { orgIdParam: 'id' },
  ),
  organizationController.getMembers,
);

// Add a member to the organization (OWNER, ADMIN only)
router.post(
  '/:id/members',
  validateRequest({ params: organizationIdParamSchema, body: addMemberSchema }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], { orgIdParam: 'id' }),
  organizationController.addMember,
);

// Update member role (OWNER, ADMIN only)
router.patch(
  '/:id/members/:userId',
  validateRequest({
    params: organizationMemberParamSchema,
    body: updateMemberRoleSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], { orgIdParam: 'id' }),
  organizationController.updateMemberRole,
);

// Remove member from organization (OWNER, ADMIN only)
router.delete(
  '/:id/members/:userId',
  validateRequest({ params: organizationMemberParamSchema }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], { orgIdParam: 'id' }),
  organizationController.removeMember,
);

// ─── Invitation Management ──────────────────────────────────────────────────

// List pending invitations (OWNER, ADMIN only)
router.get(
  '/:id/invitations',
  validateRequest({ params: organizationIdParamSchema }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], { orgIdParam: 'id' }),
  organizationController.listInvitations,
);

// Resend invitation email (OWNER, ADMIN only)
router.post(
  '/:id/invitations/:invitationId/resend',
  validateRequest({ params: organizationInvitationParamSchema }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], { orgIdParam: 'id' }),
  organizationController.resendInvitation,
);

// Revoke invitation (OWNER, ADMIN only)
router.delete(
  '/:id/invitations/:invitationId',
  validateRequest({ params: organizationInvitationParamSchema }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], { orgIdParam: 'id' }),
  organizationController.revokeInvitation,
);

export const organizationRouter = router;
