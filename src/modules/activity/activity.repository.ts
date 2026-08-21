import { prisma } from '../../config/database.js';
import type { LogActivityParams } from './activity.types.js';
import type { EntityType, ActivityAction } from '../../constants/activity.js';

export interface FindActivityFilter {
  entityType?: EntityType;
  entityId?: string;
  action?: ActivityAction;
  skip?: number;
  take?: number;
}

export class ActivityRepository {
  async create(data: LogActivityParams) {
    return prisma.activityLog.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        metadata: data.metadata ?? undefined,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async findByOrganization(organizationId: string, filter: FindActivityFilter = {}) {
    const where = {
      organizationId,
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      }),
      prisma.activityLog.count({ where }),
    ]);

    return { items, total };
  }

  async findById(organizationId: string, id: string) {
    return prisma.activityLog.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
  }
}

export const activityRepository = new ActivityRepository();
