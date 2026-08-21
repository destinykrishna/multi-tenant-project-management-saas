import { prisma } from '../../config/database.js';
import type { CreateNotificationParams } from './notification.types.js';
import type { NotificationType } from '../../constants/notification.js';

export interface FindNotificationsFilter {
  isRead?: boolean;
  type?: NotificationType;
  skip?: number;
  take?: number;
}

export class NotificationRepository {
  async create(data: CreateNotificationParams) {
    return prisma.notification.create({
      data: {
        userId: data.userId,
        organizationId: data.organizationId ?? null,
        type: data.type,
        title: data.title.trim(),
        message: data.message.trim(),
        metadata: data.metadata ?? undefined,
      },
    });
  }

  async findPaginated(userId: string, filter: FindNotificationsFilter = {}) {
    const where = {
      userId,
      ...(filter.isRead !== undefined ? { isRead: filter.isRead } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.notification.count({ where }),
    ]);

    return { items, total };
  }

  async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
  }

  async findById(id: string) {
    return prisma.notification.findUnique({
      where: { id },
    });
  }

  async markAsRead(id: string, userId: string) {
    return prisma.notification.update({
      where: {
        id,
        userId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }
}

export const notificationRepository = new NotificationRepository();
