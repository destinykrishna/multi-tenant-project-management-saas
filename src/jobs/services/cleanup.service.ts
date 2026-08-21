import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import type { CleanupJobData } from '../queues/cleanup.queue.js';

export interface CleanupSessionsResult {
  deletedCount: number;
  batches: number;
}

export interface CleanupNotificationsResult {
  deletedCount: number;
  batches: number;
}

export interface CleanupResultSummary {
  success: boolean;
  type: string;
  sessions?: CleanupSessionsResult;
  notifications?: CleanupNotificationsResult;
  timestamp: string;
}

export class CleanupService {
  async cleanupExpiredAndRevokedSessions(batchSize = 500): Promise<CleanupSessionsResult> {
    const now = new Date();
    let totalDeleted = 0;
    let batches = 0;
    let fetchedCount = batchSize;

    // Loop in batches to prevent long transaction locks on PostgreSQL
    while (fetchedCount === batchSize) {
      const expiredOrRevoked = await prisma.refreshSession.findMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
        },
        select: { id: true },
        take: batchSize,
      });

      fetchedCount = expiredOrRevoked.length;

      if (fetchedCount === 0) {
        break;
      }

      const idsToDelete = expiredOrRevoked.map((s) => s.id);
      const deleteResult = await prisma.refreshSession.deleteMany({
        where: { id: { in: idsToDelete } },
      });

      totalDeleted += deleteResult.count;
      batches += 1;
    }

    logger.info(
      { deletedCount: totalDeleted, batches },
      'Cleaned up expired and revoked refresh sessions',
    );

    return { deletedCount: totalDeleted, batches };
  }

  async cleanupStaleNotifications(
    olderThanDays = 30,
    batchSize = 500,
  ): Promise<CleanupNotificationsResult> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;
    let batches = 0;
    let fetchedCount = batchSize;

    while (fetchedCount === batchSize) {
      const staleNotifications = await prisma.notification.findMany({
        where: {
          isRead: true,
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        take: batchSize,
      });

      fetchedCount = staleNotifications.length;

      if (fetchedCount === 0) {
        break;
      }

      const idsToDelete = staleNotifications.map((n) => n.id);
      const deleteResult = await prisma.notification.deleteMany({
        where: { id: { in: idsToDelete } },
      });

      totalDeleted += deleteResult.count;
      batches += 1;
    }

    logger.info(
      { deletedCount: totalDeleted, batches, olderThanDays },
      'Cleaned up stale read notifications',
    );

    return { deletedCount: totalDeleted, batches };
  }

  async executeJob(data: CleanupJobData): Promise<CleanupResultSummary> {
    const batchSize = data.batchSize ?? 500;
    const olderThanDays = data.olderThanDays ?? 30;

    switch (data.type) {
      case 'EXPIRED_SESSIONS': {
        const sessionsResult = await this.cleanupExpiredAndRevokedSessions(batchSize);
        return {
          success: true,
          type: data.type,
          sessions: sessionsResult,
          timestamp: new Date().toISOString(),
        };
      }

      case 'STALE_NOTIFICATIONS': {
        const notifResult = await this.cleanupStaleNotifications(olderThanDays, batchSize);
        return {
          success: true,
          type: data.type,
          notifications: notifResult,
          timestamp: new Date().toISOString(),
        };
      }

      case 'ALL':
      case 'TEMP_DATA':
      default: {
        const [sessionsResult, notifResult] = await Promise.all([
          this.cleanupExpiredAndRevokedSessions(batchSize),
          this.cleanupStaleNotifications(olderThanDays, batchSize),
        ]);

        return {
          success: true,
          type: data.type,
          sessions: sessionsResult,
          notifications: notifResult,
          timestamp: new Date().toISOString(),
        };
      }
    }
  }
}

export const cleanupService = new CleanupService();
