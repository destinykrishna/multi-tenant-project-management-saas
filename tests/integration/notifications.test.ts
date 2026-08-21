import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { QueueEvents } from 'bullmq';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { notificationService } from '../../src/modules/notifications/notification.service.js';
import { notificationQueue } from '../../src/jobs/queues/notification.queue.js';
import { createNotificationWorker } from '../../src/jobs/workers/notification.worker.js';
import { defaultConnection } from '../../src/jobs/queues/queue.config.js';
import { NotificationType } from '../../src/constants/notification.js';

describe('Notifications Module Integration & Hardening Tests', () => {
  let user1: { id: string; email: string };
  let user2: { id: string; email: string };
  let token1: string;
  let token2: string;
  let queueEvents: QueueEvents;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    queueEvents = new QueueEvents(notificationQueue.name, { connection: defaultConnection });
    await queueEvents.waitUntilReady();

    const u1 = await prisma.user.create({
      data: {
        name: 'Notify User 1',
        email: `notify.user1.${Date.now()}.${randomUUID()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });
    const u2 = await prisma.user.create({
      data: {
        name: 'Notify User 2',
        email: `notify.user2.${Date.now()}.${randomUUID()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });

    createdUserIds.push(u1.id, u2.id);
    user1 = { id: u1.id, email: u1.email };
    user2 = { id: u2.id, email: u2.email };

    token1 = generateAccessToken({ userId: user1.id, email: user1.email });
    token2 = generateAccessToken({ userId: user2.id, email: user2.email });
  });

  afterAll(async () => {
    await queueEvents.close();
    await notificationQueue.close();

    if (createdUserIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    await disconnectDatabase();
  });

  describe('Authentication & Authorization', () => {
    it('should reject unauthenticated request to GET /api/v1/notifications', async () => {
      const response = await request(app).get('/api/v1/notifications');
      expect(response.status).toBe(401);
    });

    it('should reject unauthenticated request to GET /api/v1/notifications/unread', async () => {
      const response = await request(app).get('/api/v1/notifications/unread');
      expect(response.status).toBe(401);
    });

    it('should reject unauthenticated request to PATCH /api/v1/notifications/read-all', async () => {
      const response = await request(app).patch('/api/v1/notifications/read-all');
      expect(response.status).toBe(401);
    });

    it('should reject unauthenticated request to PATCH /api/v1/notifications/:id/read', async () => {
      const response = await request(app).patch(`/api/v1/notifications/${randomUUID()}/read`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/notifications', () => {
    beforeAll(async () => {
      // Seed notifications for user1
      for (let i = 1; i <= 5; i++) {
        await notificationService.createNotification({
          userId: user1.id,
          type: i % 2 === 0 ? NotificationType.TASK_ASSIGNED : NotificationType.TASK_STATUS_CHANGED,
          title: `Notification ${i}`,
          message: `Message body for notification ${i}`,
          metadata: { index: i },
        });
      }

      // Seed a notification for user2
      await notificationService.createNotification({
        userId: user2.id,
        type: NotificationType.GENERAL,
        title: 'User 2 Notification',
        message: 'Private message for User 2',
      });
    });

    it('should list paginated notifications for the authenticated user only', async () => {
      const response = await request(app)
        .get('/api/v1/notifications?page=1&limit=3')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.items)).toBe(true);
      expect(response.body.data.items.length).toBe(3);
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.total).toBe(5);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.totalPages).toBe(2);

      // Verify strict user tenant isolation
      for (const item of response.body.data.items) {
        expect(item.userId).toBe(user1.id);
      }
    });

    it('should filter notifications by type', async () => {
      const response = await request(app)
        .get(`/api/v1/notifications?type=${NotificationType.TASK_ASSIGNED}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBe(2);
      for (const item of response.body.data.items) {
        expect(item.type).toBe(NotificationType.TASK_ASSIGNED);
      }
    });

    it('should filter notifications by read status', async () => {
      const response = await request(app)
        .get('/api/v1/notifications?isRead=false')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      for (const item of response.body.data.items) {
        expect(item.isRead).toBe(false);
      }
    });

    it('should handle pagination beyond available items gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/notifications?page=10&limit=10')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.pagination.page).toBe(10);
    });
  });

  describe('GET /api/v1/notifications/unread', () => {
    it('should return accurate unread count for the authenticated user', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/unread')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(typeof response.body.data.unreadCount).toBe('number');
      expect(response.body.data.unreadCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    let notif1: { id: string };
    let notif2: { id: string };

    beforeAll(async () => {
      notif1 = await notificationService.createNotification({
        userId: user1.id,
        type: NotificationType.GENERAL,
        title: 'Read Me 1',
        message: 'Mark as read test',
      });

      notif2 = await notificationService.createNotification({
        userId: user2.id,
        type: NotificationType.GENERAL,
        title: 'Read Me 2',
        message: 'Mark as read test user 2',
      });
    });

    it('should mark an unread notification as read', async () => {
      const response = await request(app)
        .patch(`/api/v1/notifications/${notif1.id}/read`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(notif1.id);
      expect(response.body.data.isRead).toBe(true);
      expect(response.body.data.readAt).not.toBeNull();
    });

    it('should be idempotent when marking an already-read notification as read', async () => {
      const response = await request(app)
        .patch(`/api/v1/notifications/${notif1.id}/read`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.data.isRead).toBe(true);
    });

    it('should deny updating notification belonging to another user (403)', async () => {
      const response = await request(app)
        .patch(`/api/v1/notifications/${notif2.id}/read`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should return 404 for non-existent notification ID', async () => {
      const response = await request(app)
        .patch(`/api/v1/notifications/${randomUUID()}/read`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('should return 422 for invalid UUID format', async () => {
      const response = await request(app)
        .patch('/api/v1/notifications/not-a-uuid/read')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /api/v1/notifications/read-all', () => {
    it('should mark all unread notifications as read for user1 without modifying user2', async () => {
      const response = await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const unreadCheck1 = await request(app)
        .get('/api/v1/notifications/unread')
        .set('Authorization', `Bearer ${token1}`);

      expect(unreadCheck1.body.data.unreadCount).toBe(0);

      // Verify user2 unread count is preserved
      const unreadCheck2 = await request(app)
        .get('/api/v1/notifications/unread')
        .set('Authorization', `Bearer ${token2}`);

      expect(unreadCheck2.body.data.unreadCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('BullMQ Notification Queue & Worker Hardening', () => {
    it('should process queued notification job and persist to PostgreSQL', async () => {
      const worker = createNotificationWorker();
      await worker.waitUntilReady();

      try {
        const job = await notificationService.queueNotification({
          userId: user1.id,
          type: NotificationType.TASK_ASSIGNED,
          title: 'Queued Notification Test',
          message: 'Asynchronous notification delivery via BullMQ',
          metadata: { priority: 'high' },
        });

        const completedResult = (await job.waitUntilFinished(queueEvents, 10000)) as {
          delivered: boolean;
          notificationId: string;
          userId: string;
        };

        expect(completedResult).toBeDefined();
        expect(completedResult.delivered).toBe(true);
        expect(completedResult.notificationId).toBeDefined();

        // Verify in database
        const createdNotif = await prisma.notification.findUnique({
          where: { id: completedResult.notificationId },
        });
        expect(createdNotif).not.toBeNull();
        expect(createdNotif?.title).toBe('Queued Notification Test');
        expect(createdNotif?.userId).toBe(user1.id);
      } finally {
        await worker.close();
      }
    });

    it('should gracefully skip notification when target user does not exist (FK constraint)', async () => {
      const worker = createNotificationWorker();
      await worker.waitUntilReady();

      try {
        const fakeUserId = randomUUID();
        const job = await notificationService.queueNotification({
          userId: fakeUserId,
          type: NotificationType.GENERAL,
          title: 'Orphan Notification',
          message: 'This user does not exist in DB',
        });

        const result = (await job.waitUntilFinished(queueEvents, 10000)) as {
          delivered: boolean;
          skipped: boolean;
        };

        expect(result).toBeDefined();
        expect(result.delivered).toBe(false);
        expect(result.skipped).toBe(true);
      } finally {
        await worker.close();
      }
    });
  });
});
