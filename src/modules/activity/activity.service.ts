import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import {
  activityRepository,
  type ActivityRepository,
  type FindActivityFilter,
} from './activity.repository.js';
import type { LogActivityParams, ActivityLogResponse } from './activity.types.js';
import type { ListActivityQuery, ListEntityActivityQuery } from './activity.schema.js';
import type { EntityType } from '../../constants/activity.js';

export class ActivityService {
  constructor(private readonly repository: ActivityRepository = activityRepository) {}

  async logActivity(params: LogActivityParams): Promise<ActivityLogResponse> {
    const log = await this.repository.create(params);

    return {
      id: log.id,
      organizationId: log.organizationId,
      userId: log.userId,
      entityType: log.entityType,
      entityId: log.entityId,
      action: log.action,
      metadata: log.metadata,
      createdAt: log.createdAt,
      user: log.user,
    };
  }

  async getActivities(
    organizationId: string,
    query: ListActivityQuery,
  ): Promise<PaginatedResponse<ActivityLogResponse>> {
    const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

    const { items, total } = await this.repository.findByOrganization(organizationId, {
      entityType: query.entityType,
      action: query.action,
      skip,
      take,
    });

    const mappedItems: ActivityLogResponse[] = items.map((log) => ({
      id: log.id,
      organizationId: log.organizationId,
      userId: log.userId,
      entityType: log.entityType,
      entityId: log.entityId,
      action: log.action,
      metadata: log.metadata,
      createdAt: log.createdAt,
      user: log.user,
    }));

    return buildPaginatedResponse(mappedItems, total, page, limit);
  }

  async getEntityActivities(
    organizationId: string,
    entityType: EntityType,
    entityId: string,
    query: ListEntityActivityQuery,
  ): Promise<PaginatedResponse<ActivityLogResponse>> {
    const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

    const { items, total } = await this.repository.findByOrganization(organizationId, {
      entityType,
      entityId,
      action: query.action,
      skip,
      take,
    });

    const mappedItems: ActivityLogResponse[] = items.map((log) => ({
      id: log.id,
      organizationId: log.organizationId,
      userId: log.userId,
      entityType: log.entityType,
      entityId: log.entityId,
      action: log.action,
      metadata: log.metadata,
      createdAt: log.createdAt,
      user: log.user,
    }));

    return buildPaginatedResponse(mappedItems, total, page, limit);
  }

  async getOrganizationActivities(
    organizationId: string,
    filter: FindActivityFilter = {},
  ): Promise<{ items: ActivityLogResponse[]; total: number }> {
    const { items, total } = await this.repository.findByOrganization(organizationId, filter);

    return {
      items: items.map((log) => ({
        id: log.id,
        organizationId: log.organizationId,
        userId: log.userId,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        metadata: log.metadata,
        createdAt: log.createdAt,
        user: log.user,
      })),
      total,
    };
  }
}

export const activityService = new ActivityService();
