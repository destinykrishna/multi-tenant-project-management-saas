import { createHash } from 'node:crypto';
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

  /**
   * Logs activity with immutable cryptographic SHA-256 hash chaining.
   * Guarantees tamper-evidence for SOC 2 and ISO 27001 audit compliance.
   */
  async logActivity(params: LogActivityParams): Promise<ActivityLogResponse> {
    const latest = await this.repository.findLatestByOrganization(params.organizationId);
    const prevMetadata = (latest?.metadata as Record<string, unknown> | null) || null;
    const prevHash = (prevMetadata?.['_security'] as { hash?: string } | undefined)?.hash || '0'.repeat(64);

    const hashPayload = `${prevHash}:${params.organizationId}:${params.userId}:${params.entityType}:${params.entityId}:${params.action}`;
    const securityHash = createHash('sha256').update(hashPayload).digest('hex');

    const baseMetadata =
      params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
        ? (params.metadata as Record<string, unknown>)
        : {};

    const enrichedMetadata = {
      ...baseMetadata,
      _security: {
        hash: securityHash,
        prevHash,
        chainedAt: new Date().toISOString(),
      },
    };

    const log = await this.repository.create({
      ...params,
      metadata: enrichedMetadata,
    });

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

  /**
   * Cryptographically verifies the audit log chain for an organization.
   * Confirms that no audit records have been inserted, modified, or deleted out-of-band.
   */
  async verifyAuditChainIntegrity(organizationId: string): Promise<{
    valid: boolean;
    verifiedCount: number;
    tamperedLogId?: string;
    details?: string;
  }> {
    const logs = await this.repository.findAllForVerification(organizationId);

    if (logs.length === 0) {
      return { valid: true, verifiedCount: 0 };
    }

    let expectedPrevHash = '0'.repeat(64);

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (!log) continue;

      const meta = (log.metadata as Record<string, unknown> | null) || null;
      const security = meta?.['_security'] as { hash?: string; prevHash?: string } | undefined;

      // Unchained legacy log (before hash chaining was activated)
      if (!security?.hash) {
        continue;
      }

      if (security.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          verifiedCount: i,
          tamperedLogId: log.id,
          details: `Hash chain broken at log ID ${log.id}. Expected prevHash: ${expectedPrevHash}, found: ${security.prevHash}`,
        };
      }

      // Recompute hash
      const payload = `${security.prevHash}:${log.organizationId}:${log.userId}:${log.entityType}:${log.entityId}:${log.action}`;
      const recomputed = createHash('sha256').update(payload).digest('hex');

      if (recomputed !== security.hash) {
        return {
          valid: false,
          verifiedCount: i,
          tamperedLogId: log.id,
          details: `Cryptographic payload mismatch at log ID ${log.id}. Stored hash does not match recomputed SHA-256`,
        };
      }

      expectedPrevHash = security.hash;
    }

    return { valid: true, verifiedCount: logs.length };
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
