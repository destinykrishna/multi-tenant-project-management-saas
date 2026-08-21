import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationType } from '../../constants/notification.js';

export interface CreateNotificationParams {
  userId: string;
  organizationId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
}

export interface NotificationResponse {
  id: string;
  userId: string;
  organizationId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Prisma.JsonValue | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnreadSummaryResponse {
  unreadCount: number;
}
