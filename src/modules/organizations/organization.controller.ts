import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { organizationService, type OrganizationService } from './organization.service.js';
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  AddMemberInput,
  UpdateMemberRoleInput,
} from './organization.schema.js';

export class OrganizationController {
  constructor(private readonly service: OrganizationService = organizationService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const userId = req.user.id;
      const input = req.body as CreateOrganizationInput;

      const result = await this.service.createOrganization(userId, input);

      sendSuccess(res, result, 201, 'Organization created successfully');
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const userId = req.user.id;
      const result = await this.service.getUserOrganizations(userId);

      sendSuccess(res, result, 200, 'Organizations retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['id'] as string;
      const result = await this.service.getOrganizationById(organizationId);

      sendSuccess(
        res,
        {
          ...result,
          role: req.membership?.role,
        },
        200,
        'Organization retrieved successfully',
      );
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['id'] as string;
      const input = req.body as UpdateOrganizationInput;

      const result = await this.service.updateOrganization(organizationId, input);

      sendSuccess(res, result, 200, 'Organization updated successfully');
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['id'] as string;

      await this.service.deleteOrganization(organizationId);

      sendSuccess(res, null, 200, 'Organization deleted successfully');
    } catch (error) {
      next(error);
    }
  };

  // ─── Member Handlers ──────────────────────────────────────────────────────────

  getMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['id'] as string;
      const result = await this.service.getMembers(organizationId);

      sendSuccess(res, result, 200, 'Organization members retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['id'] as string;
      const input = req.body as AddMemberInput;
      const invitedById = req.user?.id;

      const result = await this.service.addMember(organizationId, input, invitedById);

      const message = result.isPending ? 'Invitation sent successfully' : 'Member added successfully';
      sendSuccess(res, result, 201, message);
    } catch (error) {
      next(error);
    }
  };

  updateMemberRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['id'] as string;
      const targetUserId = req.params['userId'] as string;
      const input = req.body as UpdateMemberRoleInput;

      const result = await this.service.updateMemberRole(organizationId, targetUserId, input);

      sendSuccess(res, result, 200, 'Member role updated successfully');
    } catch (error) {
      next(error);
    }
  };

  removeMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['id'] as string;
      const targetUserId = req.params['userId'] as string;

      await this.service.removeMember(organizationId, targetUserId);

      sendSuccess(res, null, 200, 'Member removed successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const organizationController = new OrganizationController();
