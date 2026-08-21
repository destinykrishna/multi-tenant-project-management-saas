import type { Request, Response, NextFunction } from 'express';
import { dashboardService, type DashboardService } from './dashboard.service.js';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import type { DashboardParams, GetDashboardQuery } from './dashboard.schema.js';

export class DashboardController {
  constructor(private readonly service: DashboardService = dashboardService) {}

  getDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId } = req.params as unknown as DashboardParams;
      const query = req.query as unknown as GetDashboardQuery;
      const userId = req.user?.id;

      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const data = await this.service.getDashboardData({
        organizationId,
        userId,
        recentActivityLimit: query.recentActivityLimit,
        recentNotificationsLimit: query.recentNotificationsLimit,
      });

      sendSuccess(res, data, 200, 'Dashboard data retrieved successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const dashboardController = new DashboardController();
