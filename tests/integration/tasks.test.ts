import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Tasks Module Integration Tests', () => {
  let ownerUser: { id: string; email: string; token: string };
  let adminUser: { id: string; email: string; token: string };
  let memberUser: { id: string; email: string; token: string };
  let viewerUser: { id: string; email: string; token: string };
  let outsideUser: { id: string; email: string; token: string };

  let org1Id: string;
  let org2Id: string;
  let project1Id: string;
  let project2Id: string;
  let task1Id: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Create users
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Task Owner',
          email: `tsk.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Admin',
          email: `tsk.admin.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Member',
          email: `tsk.member.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Viewer',
          email: `tsk.viewer.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Outside User',
          email: `tsk.outside.${Date.now()}@example.com`,
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

    adminUser = {
      id: users[1].id,
      email: users[1].email,
      token: generateAccessToken({ userId: users[1].id, email: users[1].email }),
    };

    memberUser = {
      id: users[2].id,
      email: users[2].email,
      token: generateAccessToken({ userId: users[2].id, email: users[2].email }),
    };

    viewerUser = {
      id: users[3].id,
      email: users[3].email,
      token: generateAccessToken({ userId: users[3].id, email: users[3].email }),
    };

    outsideUser = {
      id: users[4].id,
      email: users[4].email,
      token: generateAccessToken({ userId: users[4].id, email: users[4].email }),
    };

    // 2. Create Org 1 and Org 2
    const org1 = await prisma.organization.create({
      data: {
        name: 'Task Test Org 1',
        slug: `tsk-org-1-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    org1Id = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        name: 'Task Test Org 2',
        slug: `tsk-org-2-${randomUUID()}`,
        ownerId: outsideUser.id,
      },
    });
    org2Id = org2.id;

    // 3. Memberships
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org1Id, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: org1Id, userId: adminUser.id, role: 'ADMIN' },
        { organizationId: org1Id, userId: memberUser.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: viewerUser.id, role: 'VIEWER' },
        { organizationId: org2Id, userId: outsideUser.id, role: 'OWNER' },
      ],
    });

    // 4. Projects
    const prj1 = await prisma.project.create({
      data: {
        organizationId: org1Id,
        name: 'Project Alpha',
        key: 'ALPHA',
        createdById: ownerUser.id,
      },
    });
    project1Id = prj1.id;

    const prj2 = await prisma.project.create({
      data: {
        organizationId: org2Id,
        name: 'Project Beta',
        key: 'BETA',
        createdById: outsideUser.id,
      },
    });
    project2Id = prj2.id;
  });

  afterAll(async () => {
    if (org1Id || org2Id) {
      await prisma.task.deleteMany({
        where: { projectId: { in: [project1Id, project2Id].filter(Boolean) } },
      });
      await prisma.project.deleteMany({
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

  describe('POST /api/v1/organizations/:organizationId/projects/:projectId/tasks', () => {
    it('should allow MEMBER to create a task with valid assignment (201)', async () => {
      const dueDate = new Date(Date.now() + 86400000).toISOString();

      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          title: 'Implement Auth Refresh',
          description: 'Add token rotation and replay protection',
          status: 'TODO',
          priority: 'HIGH',
          assigneeId: adminUser.id,
          dueDate,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe('Implement Auth Refresh');
      expect(res.body.data.status).toBe('TODO');
      expect(res.body.data.priority).toBe('HIGH');
      expect(res.body.data.assigneeId).toBe(adminUser.id);
      expect(res.body.data.assignee.email).toBe(adminUser.email);
      expect(res.body.data.createdById).toBe(memberUser.id);

      task1Id = res.body.data.id;
    });

    it('should reject non-member assignee (400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          title: 'Foreign Assignee Task',
          assigneeId: outsideUser.id,
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });

    it('should reject unauthorized role VIEWER from creating tasks (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .send({
          title: 'Viewer Task Attempt',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject non-member cross-organization access on creation (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .send({
          title: 'Intruder Task',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject if project does not belong to organization (404 Project Not Found)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project2Id}/tasks`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          title: 'Mismatched Project Task',
        })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('should reject empty title (422 Validation Error)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          title: '',
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid status value (422 Validation Error)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          title: 'Valid Title',
          status: 'INVALID_STATUS',
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/organizations/:organizationId/projects/:projectId/tasks', () => {
    it('should list tasks with pagination, filters, and sorting for any member including VIEWER (200)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks?page=1&limit=10&status=TODO&priority=HIGH&sortBy=createdAt&sortOrder=desc`,
        )
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items[0].priority).toBe('HIGH');
    });

    it('should filter tasks by search query', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks?search=Auth`,
        )
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items[0].title).toContain('Auth');
    });

    it('should filter tasks by assigneeId', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks?assigneeId=${adminUser.id}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items[0].assigneeId).toBe(adminUser.id);
    });

    it('should forbid non-members from listing tasks (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject invalid organization UUID in params (422 Validation Error)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/not-a-uuid/projects/${project1Id}/tasks`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId', () => {
    it('should return task details for member (200)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(task1Id);
      expect(res.body.data.title).toBe('Implement Auth Refresh');
      expect(res.body.data.assignee).toBeDefined();
      expect(res.body.data.createdBy).toBeDefined();
    });

    it('should return 404 for non-existent taskId', async () => {
      const fakeId = randomUUID();
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${fakeId}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TASK_NOT_FOUND');
    });

    it('should reject invalid taskId format (422 Validation Error)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/not-a-valid-task-uuid`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Task Assignment, Reassignment, Unassignment & State Transitions', () => {
    it('should support task reassignment to another organization member (200)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          assigneeId: memberUser.id,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.assigneeId).toBe(memberUser.id);
      expect(res.body.data.assignee.email).toBe(memberUser.email);
    });

    it('should support unassigning a task by setting assigneeId to null (200)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          assigneeId: null,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.assigneeId).toBeNull();
      expect(res.body.data.assignee).toBeNull();
    });

    it('should reject reassigning task to a non-member user (400 Bad Request)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          assigneeId: outsideUser.id,
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });

    it('should reject unauthorized role VIEWER from updating task or assignment (403)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .send({
          title: 'Viewer Update Attempt',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow valid status transitions: TODO -> IN_PROGRESS -> DONE (200)', async () => {
      // 1. TODO -> IN_PROGRESS
      const res1 = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      expect(res1.body.data.status).toBe('IN_PROGRESS');

      // 2. IN_PROGRESS -> DONE
      const res2 = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({ status: 'DONE' })
        .expect(200);

      expect(res2.body.data.status).toBe('DONE');
    });

    it('should reject invalid state transition: DONE -> CANCELLED (400 Bad Request)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({ status: 'CANCELLED' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should reject empty update body (422 Validation Error)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({})
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject cross-organization update by outside user (403)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`,
        )
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .send({ title: 'Intruder Update' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });

  describe('DELETE /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId', () => {
    let taskToDeleteId: string;

    beforeEach(async () => {
      const tempTask = await prisma.task.create({
        data: {
          projectId: project1Id,
          title: 'Temporary Task to Delete',
          createdById: ownerUser.id,
        },
      });
      taskToDeleteId = tempTask.id;
    });

    it('should reject regular MEMBER from deleting task (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${taskToDeleteId}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow ADMIN to delete task (200)', async () => {
      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${taskToDeleteId}`,
        )
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Task deleted successfully');

      const check = await prisma.task.findUnique({
        where: { id: taskToDeleteId },
      });
      expect(check).toBeNull();
    });
  });
});
