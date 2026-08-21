import type { Request, Response, NextFunction } from 'express';
import { notificationService, type NotificationService } from './notification.service.js';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import type { ListNotificationsQuery } from './notification.schema.js';

export class NotificationController {
  constructor(private readonly service: NotificationService = notificationService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const userId = req.user.id;
      const query = req.query as unknown as ListNotificationsQuery;

      const result = await this.service.getUserNotifications(userId, query);
      sendSuccess(res, result, 200, 'Notifications retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  getUnread = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const userId = req.user.id;
      const summary = await this.service.getUnreadSummary(userId);
      sendSuccess(res, summary, 200, 'Unread notifications summary retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  markRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const userId = req.user.id;
      const id = req.params['id'] as string;

      const updated = await this.service.markAsRead(id, userId);
      sendSuccess(res, updated, 200, 'Notification marked as read successfully');
    } catch (error) {
      next(error);
    }
  };

  markAllRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const userId = req.user.id;
      const result = await this.service.markAllAsRead(userId);
      sendSuccess(res, result, 200, 'All notifications marked as read successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const notificationController = new NotificationController();
