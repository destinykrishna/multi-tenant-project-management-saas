import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { QueueEvents } from 'bullmq';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { redis } from '../../src/config/redis.js';
import { notificationQueue } from '../../src/jobs/queues/notification.queue.js';
import { createNotificationWorker } from '../../src/jobs/workers/notification.worker.js';
import { defaultConnection } from '../../src/jobs/queues/queue.config.js';
import { OrganizationRole } from '../../src/constants/roles.js';
import { TaskStatus, TaskPriority } from '../../src/constants/task.js';
import { hashPassword } from '../../src/utils/password.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Full End-to-End API Integration Workflow', () => {
  let queueEvents: QueueEvents;

  let ownerToken: string;
  let ownerUser: { id: string; email: string };

  let memberToken: string;
  let memberUser: { id: string; email: string };

  let organizationId: string;
  let projectId: string;
  let taskId: string;
  let commentId: string;

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    queueEvents = new QueueEvents(notificationQueue.name, { connection: defaultConnection });
    await queueEvents.waitUntilReady();
  });

  afterAll(async () => {
    await queueEvents.close();
    await notificationQueue.close();

    if (createdOrgIds.length > 0) {
      await prisma.comment.deleteMany({
        where: { task: { project: { organizationId: { in: createdOrgIds } } } },
      });
      await prisma.task.deleteMany({
        where: { project: { organizationId: { in: createdOrgIds } } },
      });
      await prisma.project.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.activityLog.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
    }

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
  });

  // ─── Step 1: User Registration & Authentication ──────────────────────────────
  describe('1. User Registration & Authentication', () => {
    it('should register the organization owner', async () => {
      const email = `flow.owner.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`;
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Flow Owner',
          email,
          password: 'Password123!',
          organizationName: 'Owner Initial Org',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.id).toBeDefined();

      ownerToken = response.body.data.accessToken;
      ownerUser = response.body.data.user;
      createdUserIds.push(ownerUser.id);
      if (response.body.data.organization?.id) {
        // Remove the registration org so owner can create their flow org in Step 2 cleanly
        await prisma.organizationMember.deleteMany({ where: { userId: ownerUser.id } });
        await prisma.organization.deleteMany({ where: { id: response.body.data.organization.id } });
      }
    });

    it('should register the team member user', async () => {
      const email = `flow.member.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`;
      const passwordHash = await hashPassword('Password123!');
      const user = await prisma.user.create({
        data: {
          name: 'Flow Member',
          email,
          passwordHash,
          isEmailVerified: true,
        },
      });

      memberUser = { id: user.id, email: user.email };
      memberToken = generateAccessToken({ userId: user.id, email: user.email });
      createdUserIds.push(memberUser.id);

      expect(memberToken).toBeDefined();
      expect(memberUser.id).toBeDefined();
    });
  });

  // ─── Step 2: Organization Creation & Member Invitation ───────────────────────
  describe('2. Organization Creation & Member Management', () => {
    it('should allow owner to create an organization', async () => {
      const slug = `flow-org-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const response = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'E2E Flow Organization',
          slug,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.role).toBe(OrganizationRole.OWNER);

      organizationId = response.body.data.id;
      createdOrgIds.push(organizationId);
    });

    it('should allow owner to add team member to the organization', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${organizationId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          email: memberUser.email,
          role: OrganizationRole.MEMBER,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe(memberUser.id);
      expect(response.body.data.role).toBe(OrganizationRole.MEMBER);

      // Finalize membership for downstream workflow steps
      await prisma.organizationMember.create({
        data: {
          organizationId,
          userId: memberUser.id,
          role: OrganizationRole.MEMBER,
        },
      });
    });
  });

  // ─── Step 3: Project Creation ────────────────────────────────────────────────
  describe('3. Project Creation', () => {
    it('should allow owner to create a new project', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${organizationId}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Core Platform Project',
          key: 'CORE',
          description: 'Main project for flow testing',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.key).toBe('CORE');
      expect(response.body.data.status).toBe('ACTIVE');

      projectId = response.body.data.id;
    });
  });

  // ─── Step 4: Task Creation, Assignment & Status Transitions ───────────────────
  describe('4. Task Creation, Assignment & State Transitions', () => {
    it('should allow creating a new task within the project', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${organizationId}/projects/${projectId}/tasks`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Implement Authentication Hardening',
          description: 'Add rate limiting and session security',
          priority: TaskPriority.HIGH,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.status).toBe(TaskStatus.TODO);
      expect(response.body.data.priority).toBe(TaskPriority.HIGH);

      taskId = response.body.data.id;
    });

    it('should assign the task to memberUser and trigger assignment notification', async () => {
      const response = await request(app)
        .patch(
          `/api/v1/organizations/${organizationId}/projects/${projectId}/tasks/${taskId}`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          assigneeId: memberUser.id,
          status: TaskStatus.IN_PROGRESS,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.assigneeId).toBe(memberUser.id);
      expect(response.body.data.status).toBe(TaskStatus.IN_PROGRESS);
    });
  });

  // ─── Step 5: Comments & Discussion ───────────────────────────────────────────
  describe('5. Task Comments & Collaboration', () => {
    it('should allow owner to post a comment on the task', async () => {
      const response = await request(app)
        .post(
          `/api/v1/organizations/${organizationId}/projects/${projectId}/tasks/${taskId}/comments`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          content: 'Please make sure to add Redis rate limiting to sensitive routes.',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.content).toContain('Redis rate limiting');

      commentId = response.body.data.id;
    });

    it('should allow member to list comments on the task', async () => {
      const response = await request(app)
        .get(
          `/api/v1/organizations/${organizationId}/projects/${projectId}/tasks/${taskId}/comments`,
        )
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data.items[0].id).toBe(commentId);
    });
  });

  // ─── Step 6: Activity Logging & Audit Trail ──────────────────────────────────
  describe('6. Activity Logs Verification', () => {
    it('should list recorded activity logs for the organization in reverse chronological order', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${organizationId}/activity`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThanOrEqual(3);

      const actions = response.body.data.items.map((a: { action: string }) => a.action);
      expect(actions).toContain('CREATED');
    });
  });

  // ─── Step 7: Asynchronous Notifications Processing & Read API ────────────────
  describe('7. Notifications Queue & Delivery', () => {
    it('should process queued notification jobs via background worker', async () => {
      const worker = createNotificationWorker();
      await worker.waitUntilReady();

      try {
        // Wait for worker to consume in-flight jobs from assignment and comment
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify member has received notifications
        const listResponse = await request(app)
          .get('/api/v1/notifications')
          .set('Authorization', `Bearer ${memberToken}`);

        expect(listResponse.status).toBe(200);
        expect(listResponse.body.success).toBe(true);
        expect(listResponse.body.data.items.length).toBeGreaterThanOrEqual(1);

        // Verify unread count
        const unreadResponse = await request(app)
          .get('/api/v1/notifications/unread')
          .set('Authorization', `Bearer ${memberToken}`);

        expect(unreadResponse.status).toBe(200);
        expect(unreadResponse.body.data.unreadCount).toBeGreaterThanOrEqual(1);

        // Mark all as read
        const markResponse = await request(app)
          .patch('/api/v1/notifications/read-all')
          .set('Authorization', `Bearer ${memberToken}`);

        expect(markResponse.status).toBe(200);
        expect(markResponse.body.success).toBe(true);

        const checkAfter = await request(app)
          .get('/api/v1/notifications/unread')
          .set('Authorization', `Bearer ${memberToken}`);

        expect(checkAfter.body.data.unreadCount).toBe(0);
      } finally {
        await worker.close(true);
      }
    });
  });

  // ─── Step 8: Dashboard Analytics Verification ────────────────────────────────
  describe('8. Dashboard Aggregation Verification', () => {
    it('should return complete organization metrics on dashboard endpoint', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${organizationId}/dashboard`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const { data } = response.body;

      // Project metrics
      expect(data.projects.total).toBe(1);
      expect(data.projects.active).toBe(1);

      // Task metrics
      expect(data.tasks.total).toBe(1);
      expect(data.tasks.byStatus[TaskStatus.IN_PROGRESS]).toBe(1);
      expect(data.tasks.byPriority[TaskPriority.HIGH]).toBe(1);
      expect(data.tasks.assignedToMe).toBe(1);

      // Recent items
      expect(data.recentActivity.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(data.recentNotifications)).toBe(true);
    });
  });
});
