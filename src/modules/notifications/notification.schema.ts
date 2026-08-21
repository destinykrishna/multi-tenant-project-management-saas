import { z } from 'zod';
import { NotificationType } from '../../constants/notification.js';

export const notificationParamSchema = z.object({
  id: z.uuid('Invalid notification ID format'),
});

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isRead: z
    .preprocess((val) => {
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return val;
    }, z.boolean().optional())
    .optional(),
  type: z
    .enum([
      NotificationType.TASK_ASSIGNED,
      NotificationType.TASK_STATUS_CHANGED,
      NotificationType.MEMBER_ADDED,
      NotificationType.MEMBER_REMOVED,
      NotificationType.PROJECT_UPDATED,
      NotificationType.COMMENT_ADDED,
      NotificationType.GENERAL,
    ])
    .optional(),
});

export type NotificationParams = z.infer<typeof notificationParamSchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
