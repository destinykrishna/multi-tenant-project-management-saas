import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { activityService } from '../../src/modules/activity/activity.service.js';
import { EntityType, ActivityAction } from '../../src/constants/activity.js';

describe('Activity Logs Read API & Service Integration Tests', () => {
  let ownerUser: { id: string; email: string; token: string };
  let memberUser: { id: string; email: string; token: string };
  let viewerUser: { id: string; email: string; token: string };
  let outsideUser: { id: string; email: string; token: string };

  let org1Id: string;
  let org2Id: string;
  let sampleTaskId: string;
  let sampleProjectId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Activity Owner',
          email: `act.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Activity Member',
          email: `act.mem.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Activity Viewer',
          email: `act.view.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Activity Outside',
          email: `act.out.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
    ]);

    users.forEach((u) => createdUserIds.push(u.id));

    ownerUser = {
      id: users[0].id,
      email: users[0].email,
      token: generateAccessToken({ userId: users[0].id, email: users[0].email }),
    };

    memberUser = {
      id: users[1].id,
      email: users[1].email,
      token: generateAccessToken({ userId: users[1].id, email: users[1].email }),
    };

    viewerUser = {
      id: users[2].id,
      email: users[2].email,
      token: generateAccessToken({ userId: users[2].id, email: users[2].email }),
    };

    outsideUser = {
      id: users[3].id,
      email: users[3].email,
      token: generateAccessToken({ userId: users[3].id, email: users[3].email }),
    };

    const org1 = await prisma.organization.create({
      data: {
        name: 'Activity Org 1',
        slug: `act-org-1-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    org1Id = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        name: 'Activity Org 2',
        slug: `act-org-2-${randomUUID()}`,
        ownerId: outsideUser.id,
      },
    });
    org2Id = org2.id;

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org1Id, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: org1Id, userId: memberUser.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: viewerUser.id, role: 'VIEWER' },
        { organizationId: org2Id, userId: outsideUser.id, role: 'OWNER' },
      ],
    });

    sampleProjectId = randomUUID();
    sampleTaskId = randomUUID();

    // Populate initial logs in org 1
    await activityService.logActivity({
      organizationId: org1Id,
      userId: ownerUser.id,
      entityType: EntityType.PROJECT,
      entityId: sampleProjectId,
      action: ActivityAction.CREATED,
      metadata: { name: 'Main Project', key: 'MAIN' },
    });

    await activityService.logActivity({
      organizationId: org1Id,
      userId: memberUser.id,
      entityType: EntityType.TASK,
      entityId: sampleTaskId,
      action: ActivityAction.CREATED,
      metadata: { title: 'First Task' },
    });

    await activityService.logActivity({
      organizationId: org1Id,
      userId: memberUser.id,
      entityType: EntityType.TASK,
      entityId: sampleTaskId,
      action: ActivityAction.TASK_STATUS_CHANGED,
      metadata: { previousStatus: 'TODO', newStatus: 'IN_PROGRESS' },
    });

    // Populate log in org 2
    await activityService.logActivity({
      organizationId: org2Id,
      userId: outsideUser.id,
      entityType: EntityType.ORGANIZATION,
      entityId: org2Id,
      action: ActivityAction.CREATED,
      metadata: { name: 'Activity Org 2' },
    });
  });

  afterAll(async () => {
    if (org1Id || org2Id) {
      await prisma.activityLog.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [org1Id, org2Id].filter(Boolean) } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    await disconnectDatabase();
  });

  describe('GET /api/v1/organizations/:organizationId/activity', () => {
    it('should allow VIEWER to list organization activity (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity?page=1&limit=10`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(3);
      expect(res.body.data.pagination.page).toBe(1);
      // Newest activity first
      expect(res.body.data.items[0].action).toBe(ActivityAction.TASK_STATUS_CHANGED);
      expect(res.body.data.items[0].user.email).toBe(memberUser.email);
    });

    it('should filter activity by entityType (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity?entityType=PROJECT`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].entityType).toBe(EntityType.PROJECT);
    });

    it('should filter activity by action (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity?action=TASK_STATUS_CHANGED`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].action).toBe(ActivityAction.TASK_STATUS_CHANGED);
    });

    it('should reject non-member from viewing organization activity (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity`)
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should never expose activity from another organization (tenant isolation)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org2Id}/activity`)
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.every((i: { organizationId: string }) => i.organizationId === org2Id)).toBe(true);
      expect(res.body.data.items.some((i: { organizationId: string }) => i.organizationId === org1Id)).toBe(false);
    });

    it('should reject invalid entityType query (422 Validation Error)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity?entityType=INVALID_TYPE`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/organizations/:organizationId/activity/:entityType/:entityId', () => {
    it('should return entity-specific activity logs (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity/TASK/${sampleTaskId}`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.items.every((i: { entityId: string }) => i.entityId === sampleTaskId)).toBe(true);
    });

    it('should support action filtering on entity-specific activity (200)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/activity/TASK/${sampleTaskId}?action=TASK_STATUS_CHANGED`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].action).toBe(ActivityAction.TASK_STATUS_CHANGED);
    });

    it('should reject invalid entityType in params (422 Validation Error)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity/UNKNOWN_ENTITY/${sampleTaskId}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-member from viewing entity activity (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/activity/TASK/${sampleTaskId}`)
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });
});
