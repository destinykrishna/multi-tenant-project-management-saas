import { NotFoundError, ForbiddenError } from '../../utils/errors.js';
import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import { notificationRepository, type NotificationRepository } from './notification.repository.js';
import { addNotificationJob } from '../../jobs/queues/notification.queue.js';
import type {
  CreateNotificationParams,
  NotificationResponse,
  UnreadSummaryResponse,
} from './notification.types.js';
import type { ListNotificationsQuery } from './notification.schema.js';

export class NotificationService {
  constructor(private readonly repository: NotificationRepository = notificationRepository) {}

  async getUserNotifications(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<PaginatedResponse<NotificationResponse>> {
    const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

    const { items, total } = await this.repository.findPaginated(userId, {
      isRead: query.isRead,
      type: query.type,
      skip,
      take,
    });

    const mappedItems: NotificationResponse[] = items.map((n) => ({
      id: n.id,
      userId: n.userId,
      organizationId: n.organizationId,
      type: n.type,
      title: n.title,
      message: n.message,
      metadata: n.metadata,
      isRead: n.isRead,
      readAt: n.readAt,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));

    return buildPaginatedResponse(mappedItems, total, page, limit);
  }

  async getUnreadSummary(userId: string): Promise<UnreadSummaryResponse> {
    const count = await this.repository.countUnread(userId);
    return { unreadCount: count };
  }

  async markAsRead(id: string, userId: string): Promise<NotificationResponse> {
    const existing = await this.repository.findById(id);

    if (!existing) {
      throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenError(
        'You can only access your own notifications',
        'INSUFFICIENT_PERMISSIONS',
      );
    }

    const updated = await this.repository.markAsRead(id, userId);

    return {
      id: updated.id,
      userId: updated.userId,
      organizationId: updated.organizationId,
      type: updated.type,
      title: updated.title,
      message: updated.message,
      metadata: updated.metadata,
      isRead: updated.isRead,
      readAt: updated.readAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const result = await this.repository.markAllAsRead(userId);
    return { count: result.count };
  }

  async createNotification(params: CreateNotificationParams): Promise<NotificationResponse> {
    const created = await this.repository.create(params);

    return {
      id: created.id,
      userId: created.userId,
      organizationId: created.organizationId,
      type: created.type,
      title: created.title,
      message: created.message,
      metadata: created.metadata,
      isRead: created.isRead,
      readAt: created.readAt,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async queueNotification(params: CreateNotificationParams) {
    return addNotificationJob({
      userId: params.userId,
      organizationId: params.organizationId ?? '',
      type: params.type,
      title: params.title,
      message: params.message,
      metadata: params.metadata as Record<string, unknown> | undefined,
    });
  }
}

export const notificationService = new NotificationService();
