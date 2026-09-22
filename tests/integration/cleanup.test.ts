import { randomUUID } from 'node:crypto';
import { QueueEvents } from 'bullmq';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { cleanupService } from '../../src/jobs/services/cleanup.service.js';
import { cleanupQueue, addCleanupJob, scheduleRecurringCleanupJob } from '../../src/jobs/queues/cleanup.queue.js';
import { createCleanupWorker } from '../../src/jobs/workers/cleanup.worker.js';
import { defaultConnection } from '../../src/jobs/queues/queue.config.js';
import { NotificationType } from '../../src/constants/notification.js';

describe('Cleanup Jobs & Worker Integration Tests', () => {
  let testUser: { id: string; email: string };
  let queueEvents: QueueEvents;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    queueEvents = new QueueEvents(cleanupQueue.name, { connection: defaultConnection });
    await queueEvents.waitUntilReady();

    const user = await prisma.user.create({
      data: {
        name: 'Cleanup Test User',
        email: `cleanup.user.${Date.now()}.${randomUUID()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });

    testUser = { id: user.id, email: user.email };
    createdUserIds.push(user.id);
  });

  afterAll(async () => {
    await queueEvents.close();
    await cleanupQueue.close();

    if (createdUserIds.length > 0) {
      await prisma.refreshSession.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    await disconnectDatabase();
  });

  describe('Session Cleanup Logic', () => {
    beforeEach(async () => {
      // Clear sessions for test user before each test
      await prisma.refreshSession.deleteMany({
        where: { userId: testUser.id },
      });
    });

    it('should delete expired refresh sessions and keep active sessions intact', async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 1000 * 60 * 60 * 24); // 1 day ago
      const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7); // 7 days future

      // Create 2 expired sessions
      await prisma.refreshSession.createMany({
        data: [
          {
            userId: testUser.id,
            tokenHash: `expired-1-${randomUUID()}`,
            expiresAt: pastDate,
          },
          {
            userId: testUser.id,
            tokenHash: `expired-2-${randomUUID()}`,
            expiresAt: pastDate,
          },
        ],
      });

      // Create 1 active session
      const activeSession = await prisma.refreshSession.create({
        data: {
          userId: testUser.id,
          tokenHash: `active-1-${randomUUID()}`,
          expiresAt: futureDate,
        },
      });

      const result = await cleanupService.cleanupExpiredAndRevokedSessions(100);

      expect(result.deletedCount).toBeGreaterThanOrEqual(2);

      // Verify active session was preserved
      const remainingActive = await prisma.refreshSession.findUnique({
        where: { id: activeSession.id },
      });
      expect(remainingActive).not.toBeNull();
      expect(remainingActive?.id).toBe(activeSession.id);
    });

    it('should delete revoked refresh sessions', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

      // Create revoked session
      await prisma.refreshSession.create({
        data: {
          userId: testUser.id,
          tokenHash: `revoked-1-${randomUUID()}`,
          expiresAt: futureDate,
          revokedAt: new Date(Date.now() - 1000 * 60), // Revoked 1 min ago
        },
      });

      const result = await cleanupService.cleanupExpiredAndRevokedSessions(100);

      expect(result.deletedCount).toBeGreaterThanOrEqual(1);

      const revokedLeft = await prisma.refreshSession.findMany({
        where: { userId: testUser.id, revokedAt: { not: null } },
      });
      expect(revokedLeft.length).toBe(0);
    });

    it('should process records in batches correctly', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60);

      // Create 5 expired sessions
      const sessionsData = Array.from({ length: 5 }, (_, i) => ({
        userId: testUser.id,
        tokenHash: `batch-exp-${i}-${randomUUID()}`,
        expiresAt: pastDate,
      }));

      await prisma.refreshSession.createMany({ data: sessionsData });

      // Run cleanup with batchSize = 2 -> should take at least 3 batches
      const result = await cleanupService.cleanupExpiredAndRevokedSessions(2);

      expect(result.deletedCount).toBeGreaterThanOrEqual(5);
      expect(result.batches).toBeGreaterThanOrEqual(3);
    });

    it('should be idempotent on repeated runs', async () => {
      // First run cleans up
      await cleanupService.cleanupExpiredAndRevokedSessions(100);

      // Subsequent run should find 0 and succeed cleanly
      const secondRun = await cleanupService.cleanupExpiredAndRevokedSessions(100);
      expect(secondRun.deletedCount).toBe(0);
      expect(secondRun.batches).toBe(0);
    });
  });

  describe('Stale Notifications Cleanup', () => {
    it('should delete read notifications older than retention cutoff', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days old
      const recentDate = new Date();

      // Old read notification
      const oldNotif = await prisma.notification.create({
        data: {
          userId: testUser.id,
          type: NotificationType.GENERAL,
          title: 'Old Notification',
          message: 'Old body',
          isRead: true,
          readAt: oldDate,
          createdAt: oldDate,
        },
      });

      // Recent read notification
      const recentNotif = await prisma.notification.create({
        data: {
          userId: testUser.id,
          type: NotificationType.GENERAL,
          title: 'Recent Notification',
          message: 'Recent body',
          isRead: true,
          readAt: recentDate,
          createdAt: recentDate,
        },
      });

      const result = await cleanupService.cleanupStaleNotifications(30, 100);
      expect(result.deletedCount).toBeGreaterThanOrEqual(1);

      // Verify old is deleted and recent is preserved
      const checkOld = await prisma.notification.findUnique({ where: { id: oldNotif.id } });
      const checkRecent = await prisma.notification.findUnique({ where: { id: recentNotif.id } });

      expect(checkOld).toBeNull();
      expect(checkRecent).not.toBeNull();
    });
  });

  describe('BullMQ Cleanup Worker & Scheduling', () => {
    it('should process a queued cleanup job via the worker', async () => {
      const worker = createCleanupWorker();
      await worker.waitUntilReady();

      try {
        const job = await addCleanupJob({
          type: 'EXPIRED_SESSIONS',
          batchSize: 50,
        });

        const completedResult = (await job.waitUntilFinished(queueEvents, 10000)) as {
          success: boolean;
          type: string;
          sessions?: { deletedCount: number };
        };

        expect(completedResult).toBeDefined();
        expect(completedResult.success).toBe(true);
        expect(completedResult.type).toBe('EXPIRED_SESSIONS');
        expect(completedResult.sessions).toBeDefined();
      } finally {
        await worker.close(true);
      }
    });

    it('should register a recurring cleanup repeatable job without errors', async () => {
      const job = await scheduleRecurringCleanupJob('0 4 * * *', {
        type: 'ALL',
        olderThanDays: 30,
      });

      expect(job).toBeDefined();
      expect(job.name).toBe('recurring-daily-cleanup');
    });
  });
});
