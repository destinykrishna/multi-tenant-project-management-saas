import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { OrganizationRole } from '../constants/roles.js';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../utils/errors.js';

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    membership?: OrganizationMembership;
  }
}

export interface AuthorizeOptions {
  orgIdParam?: string;
}

export function authorizeOrgRole(
  allowedRoles: OrganizationRole | OrganizationRole[],
  options: AuthorizeOptions = {},
) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Ensure user is authenticated first
      if (!req.user?.id) {
        next(new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED'));
        return;
      }

      // 2. Extract organization ID
      const paramName = options.orgIdParam ?? 'organizationId';
      const organizationId =
        (req.params[paramName] as string | undefined) ??
        (req.params['orgId'] as string | undefined) ??
        ((req.body as Record<string, unknown> | undefined)?.[paramName] as string | undefined) ??
        ((req.body as Record<string, unknown> | undefined)?.['organizationId'] as
          string | undefined) ??
        (req.query[paramName] as string | undefined) ??
        (req.query['organizationId'] as string | undefined);

      if (!organizationId) {
        next(new BadRequestError('Organization ID is required in the request', 'ORG_ID_REQUIRED'));
        return;
      }

      // 3. Query membership directly from database
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: req.user.id,
          },
        },
      });

      // 4. Reject non-members
      if (!member) {
        next(
          new ForbiddenError(
            'You are not a member of this organization',
            'NOT_AN_ORGANIZATION_MEMBER',
          ),
        );
        return;
      }

      // 5. Verify role has required permission
      const userRole = member.role;
      if (!roles.includes(userRole)) {
        next(
          new ForbiddenError(
            'You do not have sufficient permissions to perform this action',
            'INSUFFICIENT_PERMISSIONS',
          ),
        );
        return;
      }

      // 6. Attach verified membership to request
      req.membership = {
        id: member.id,
        organizationId: member.organizationId,
        userId: member.userId,
        role: userRole,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireOrgMember(options: AuthorizeOptions = {}) {
  return authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ],
    options,
  );
}
