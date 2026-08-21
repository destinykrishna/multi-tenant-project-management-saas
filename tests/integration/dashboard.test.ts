import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { redis } from '../../src/config/redis.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { OrganizationRole } from '../../src/constants/roles.js';
import { TaskStatus, TaskPriority } from '../../src/constants/task.js';
import { ActivityAction, EntityType } from '../../src/constants/activity.js';
import { NotificationType } from '../../src/constants/notification.js';

describe('Dashboard Module Integration Tests', () => {
  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let nonMemberUser: { id: string; email: string };
  let ownerToken: string;
  let memberToken: string;
  let nonMemberToken: string;

  let orgA: { id: string };
  let orgB: { id: string };

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Users
    const u1 = await prisma.user.create({
      data: {
        name: 'Dash Owner',
        email: `dash.owner.${Date.now()}.${randomUUID()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });
    const u2 = await prisma.user.create({
      data: {
        name: 'Dash Member',
        email: `dash.member.${Date.now()}.${randomUUID()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });
    const u3 = await prisma.user.create({
      data: {
        name: 'Dash NonMember',
        email: `dash.nonmember.${Date.now()}.${randomUUID()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });

    createdUserIds.push(u1.id, u2.id, u3.id);
    ownerUser = { id: u1.id, email: u1.email };
    memberUser = { id: u2.id, email: u2.email };
    nonMemberUser = { id: u3.id, email: u3.email };

    ownerToken = generateAccessToken({ userId: ownerUser.id, email: ownerUser.email });
    memberToken = generateAccessToken({ userId: memberUser.id, email: memberUser.email });
    nonMemberToken = generateAccessToken({ userId: nonMemberUser.id, email: nonMemberUser.email });

    // 2. Create Organizations
    const oA = await prisma.organization.create({
      data: {
        name: 'Org Dashboard A',
        slug: `org-dash-a-${Date.now()}-${randomUUID().slice(0, 6)}`,
        ownerId: ownerUser.id,
        members: {
          create: [
            { userId: ownerUser.id, role: OrganizationRole.OWNER },
            { userId: memberUser.id, role: OrganizationRole.MEMBER },
          ],
        },
      },
    });

    const oB = await prisma.organization.create({
      data: {
        name: 'Org Dashboard B',
        slug: `org-dash-b-${Date.now()}-${randomUUID().slice(0, 6)}`,
        ownerId: nonMemberUser.id,
        members: {
          create: [{ userId: nonMemberUser.id, role: OrganizationRole.OWNER }],
        },
      },
    });

    createdOrgIds.push(oA.id, oB.id);
    orgA = { id: oA.id };
    orgB = { id: oB.id };

    // 3. Seed Projects for Org A (1 Active, 1 Archived)
    const p1 = await prisma.project.create({
      data: {
        name: 'Active Project 1',
        key: 'AP1',
        organizationId: orgA.id,
        status: 'ACTIVE',
        createdById: ownerUser.id,
      },
    });
    const p2 = await prisma.project.create({
      data: {
        name: 'Archived Project 2',
        key: 'AP2',
        organizationId: orgA.id,
        status: 'ARCHIVED',
        createdById: ownerUser.id,
      },
    });

    // 4. Seed Tasks in Org A
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day overdue
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Overdue task assigned to memberUser
    await prisma.task.create({
      data: {
        title: 'Overdue Task For Member',
        projectId: p1.id,
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        assigneeId: memberUser.id,
        createdById: ownerUser.id,
        dueDate: pastDate,
      },
    });

    // Completed task (should not count as overdue or assignedToMe)
    await prisma.task.create({
      data: {
        title: 'Completed Task',
        projectId: p1.id,
        status: TaskStatus.DONE,
        priority: TaskPriority.MEDIUM,
        assigneeId: memberUser.id,
        createdById: ownerUser.id,
        dueDate: pastDate,
      },
    });

    // Future task assigned to ownerUser
    await prisma.task.create({
      data: {
        title: 'Future Task',
        projectId: p2.id,
        status: TaskStatus.TODO,
        priority: TaskPriority.LOW,
        assigneeId: ownerUser.id,
        createdById: ownerUser.id,
        dueDate: futureDate,
      },
    });

    // 5. Seed Activity Logs
    await prisma.activityLog.createMany({
      data: [
        {
          organizationId: orgA.id,
          userId: ownerUser.id,
          entityType: EntityType.PROJECT,
          entityId: p1.id,
          action: ActivityAction.CREATED,
          createdAt: new Date(Date.now() - 10000),
        },
        {
          organizationId: orgA.id,
          userId: memberUser.id,
          entityType: EntityType.TASK,
          entityId: randomUUID(),
          action: ActivityAction.TASK_STATUS_CHANGED,
          createdAt: new Date(),
        },
      ],
    });

    // 6. Seed Notifications for memberUser
    await prisma.notification.createMany({
      data: [
        {
          userId: memberUser.id,
          type: NotificationType.TASK_ASSIGNED,
          title: 'You were assigned a task',
          message: 'Task assigned message',
          isRead: false,
        },
      ],
    });
  });

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
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
      await prisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    await disconnectDatabase();
    redis.disconnect();
  });

  describe('Authentication & Authorization', () => {
    it('should reject unauthenticated requests (401)', async () => {
      const response = await request(app).get(
        `/api/v1/organizations/${orgA.id}/dashboard`,
      );
      expect(response.status).toBe(401);
    });

    it('should reject non-member user access to dashboard (403)', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/dashboard`)
        .set('Authorization', `Bearer ${nonMemberToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should allow valid organization member to access dashboard (200)', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/dashboard`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.organizationId).toBe(orgA.id);
    });
  });

  describe('Metrics Aggregation & Data Accuracy', () => {
    it('should return accurate project metrics', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/dashboard`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.projects.total).toBe(2);
      expect(response.body.data.projects.active).toBe(1);
    });

    it('should return accurate task metrics and user-specific counts', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/dashboard`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      const { tasks } = response.body.data;

      expect(tasks.total).toBe(3);
      expect(tasks.byStatus[TaskStatus.IN_PROGRESS]).toBe(1);
      expect(tasks.byStatus[TaskStatus.DONE]).toBe(1);
      expect(tasks.byStatus[TaskStatus.TODO]).toBe(1);
      expect(tasks.byPriority[TaskPriority.HIGH]).toBe(1);
      expect(tasks.byPriority[TaskPriority.LOW]).toBe(1);

      // Overdue is 1 (the in-progress task past due; the done task does not count)
      expect(tasks.overdue).toBe(1);

      // Assigned to memberUser is 1 (the in-progress task; the done task does not count)
      expect(tasks.assignedToMe).toBe(1);
    });

    it('should return recent activity and notifications with limit filtering', async () => {
      const response = await request(app)
        .get(
          `/api/v1/organizations/${orgA.id}/dashboard?recentActivityLimit=1&recentNotificationsLimit=1`,
        )
        .set('Authorization', `Bearer ${memberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.recentActivity.length).toBe(1);
      expect(response.body.data.recentNotifications.length).toBe(1);
      expect(response.body.data.recentActivity[0].entityType).toBe(EntityType.TASK);
    });
  });

  describe('Tenant Isolation', () => {
    it('should return 0 counts and empty activity for an empty organization B', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${orgB.id}/dashboard`)
        .set('Authorization', `Bearer ${nonMemberToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.organizationId).toBe(orgB.id);
      expect(response.body.data.projects.total).toBe(0);
      expect(response.body.data.projects.active).toBe(0);
      expect(response.body.data.tasks.total).toBe(0);
      expect(response.body.data.tasks.overdue).toBe(0);
      expect(response.body.data.recentActivity).toEqual([]);
    });
  });
});
