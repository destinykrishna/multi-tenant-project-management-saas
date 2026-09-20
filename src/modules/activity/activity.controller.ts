import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { activityService, type ActivityService } from './activity.service.js';
import type { ListActivityQuery, ListEntityActivityQuery } from './activity.schema.js';
import type { EntityType } from '../../constants/activity.js';

export class ActivityController {
  constructor(private readonly service: ActivityService = activityService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const query = req.query as unknown as ListActivityQuery;

      const result = await this.service.getActivities(organizationId, query);

      sendSuccess(res, result, 200, 'Activities retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  listByEntity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const entityType = req.params['entityType'] as EntityType;
      const entityId = req.params['entityId'] as string;
      const query = req.query as unknown as ListEntityActivityQuery;

      const result = await this.service.getEntityActivities(
        organizationId,
        entityType,
        entityId,
        query,
      );

      sendSuccess(res, result, 200, 'Entity activities retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  verifyIntegrity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const result = await this.service.verifyAuditChainIntegrity(organizationId);

      sendSuccess(res, result, 200, 'Audit trail integrity verified');
    } catch (error) {
      next(error);
    }
  };
}

export const activityController = new ActivityController();
