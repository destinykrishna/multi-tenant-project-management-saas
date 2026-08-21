import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Comments Module Integration Tests', () => {
  let ownerUser: { id: string; email: string; token: string };
  let adminUser: { id: string; email: string; token: string };
  let member1User: { id: string; email: string; token: string };
  let member2User: { id: string; email: string; token: string };
  let viewerUser: { id: string; email: string; token: string };
  let outsideUser: { id: string; email: string; token: string };

  let org1Id: string;
  let org2Id: string;
  let project1Id: string;
  let project2Id: string;
  let task1Id: string;
  let task2Id: string;
  let comment1Id: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Create users
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Comment Owner',
          email: `cmt.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Comment Admin',
          email: `cmt.admin.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Comment Member 1',
          email: `cmt.mem1.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Comment Member 2',
          email: `cmt.mem2.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Comment Viewer',
          email: `cmt.viewer.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Comment Outside',
          email: `cmt.outside.${Date.now()}@example.com`,
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

    member1User = {
      id: users[2].id,
      email: users[2].email,
      token: generateAccessToken({ userId: users[2].id, email: users[2].email }),
    };

    member2User = {
      id: users[3].id,
      email: users[3].email,
      token: generateAccessToken({ userId: users[3].id, email: users[3].email }),
    };

    viewerUser = {
      id: users[4].id,
      email: users[4].email,
      token: generateAccessToken({ userId: users[4].id, email: users[4].email }),
    };

    outsideUser = {
      id: users[5].id,
      email: users[5].email,
      token: generateAccessToken({ userId: users[5].id, email: users[5].email }),
    };

    // 2. Create Org 1 and Org 2
    const org1 = await prisma.organization.create({
      data: {
        name: 'Comment Org 1',
        slug: `cmt-org-1-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    org1Id = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        name: 'Comment Org 2',
        slug: `cmt-org-2-${randomUUID()}`,
        ownerId: outsideUser.id,
      },
    });
    org2Id = org2.id;

    // 3. Memberships
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org1Id, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: org1Id, userId: adminUser.id, role: 'ADMIN' },
        { organizationId: org1Id, userId: member1User.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: member2User.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: viewerUser.id, role: 'VIEWER' },
        { organizationId: org2Id, userId: outsideUser.id, role: 'OWNER' },
      ],
    });

    // 4. Projects
    const prj1 = await prisma.project.create({
      data: {
        organizationId: org1Id,
        name: 'Comment Project 1',
        key: 'CPRJ1',
        createdById: ownerUser.id,
      },
    });
    project1Id = prj1.id;

    const prj2 = await prisma.project.create({
      data: {
        organizationId: org2Id,
        name: 'Comment Project 2',
        key: 'CPRJ2',
        createdById: outsideUser.id,
      },
    });
    project2Id = prj2.id;

    // 5. Tasks
    const tsk1 = await prisma.task.create({
      data: {
        projectId: project1Id,
        title: 'Task for Comments',
        createdById: ownerUser.id,
      },
    });
    task1Id = tsk1.id;

    const tsk2 = await prisma.task.create({
      data: {
        projectId: project2Id,
        title: 'Task in Org 2',
        createdById: outsideUser.id,
      },
    });
    task2Id = tsk2.id;
  });

  afterAll(async () => {
    if (org1Id || org2Id) {
      await prisma.comment.deleteMany({
        where: { taskId: { in: [task1Id, task2Id].filter(Boolean) } },
      });
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

  describe('POST /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/comments', () => {
    it('should allow MEMBER to create a comment on a task (201)', async () => {
      const res = await request(app)
        .post(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .send({
          content: 'This is a test comment by Member 1.',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.content).toBe('This is a test comment by Member 1.');
      expect(res.body.data.userId).toBe(member1User.id);
      expect(res.body.data.user.email).toBe(member1User.email);

      comment1Id = res.body.data.id;
    });

    it('should reject empty comment content (422 Validation Error)', async () => {
      const res = await request(app)
        .post(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .send({
          content: '   ',
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject VIEWER from creating comments (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .post(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .send({
          content: 'Viewer commenting attempt',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject non-member from creating comments (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .post(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .send({
          content: 'Intruder comment',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject creating comment on mismatched task/org (404 Task Not Found)', async () => {
      const res = await request(app)
        .post(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task2Id}/comments`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          content: 'Mismatched task comment',
        })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TASK_NOT_FOUND');
    });

    it('should reject invalid UUID param formats (422 Validation Error)', async () => {
      const res = await request(app)
        .post(
          `/api/v1/organizations/not-a-uuid/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          content: 'Invalid param test',
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/comments', () => {
    it('should list comments with pagination and sorting for any member including VIEWER (200)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments?page=1&limit=10&sortBy=createdAt&sortOrder=asc`,
        )
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items[0].content).toBe('This is a test comment by Member 1.');
    });

    it('should reject non-member from listing comments (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });

  describe('PATCH /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/comments/:commentId', () => {
    it('should allow author to edit their own comment (200)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${comment1Id}`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .send({
          content: 'Updated comment content by author.',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Updated comment content by author.');
    });

    it('should reject editing another user comment (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${comment1Id}`,
        )
        .set('Authorization', `Bearer ${member2User.token}`)
        .send({
          content: 'Hijack comment content attempt.',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject empty update content (422 Validation Error)', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${comment1Id}`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .send({
          content: '  ',
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent comment update', async () => {
      const fakeCommentId = randomUUID();
      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${fakeCommentId}`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .send({
          content: 'Updating non-existent comment',
        })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('COMMENT_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/comments/:commentId', () => {
    let commentToDeleteId: string;

    beforeEach(async () => {
      const tempComment = await prisma.comment.create({
        data: {
          taskId: task1Id,
          userId: member1User.id,
          content: 'Temporary comment to be deleted',
        },
      });
      commentToDeleteId = tempComment.id;
    });

    it('should reject another regular member from deleting comment (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${commentToDeleteId}`,
        )
        .set('Authorization', `Bearer ${member2User.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow author to delete their own comment (200)', async () => {
      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${commentToDeleteId}`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Comment deleted successfully');

      const check = await prisma.comment.findUnique({
        where: { id: commentToDeleteId },
      });
      expect(check).toBeNull();
    });

    it('should allow moderator (ADMIN) to delete any comment (200)', async () => {
      const adminTempComment = await prisma.comment.create({
        data: {
          taskId: task1Id,
          userId: member2User.id,
          content: 'Member comment moderated by admin',
        },
      });

      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${adminTempComment.id}`,
        )
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Comment deleted successfully');

      const check = await prisma.comment.findUnique({
        where: { id: adminTempComment.id },
      });
      expect(check).toBeNull();
    });

    it('should allow moderator (OWNER) to delete any comment (200)', async () => {
      const ownerTempComment = await prisma.comment.create({
        data: {
          taskId: task1Id,
          userId: member2User.id,
          content: 'Member comment moderated by owner',
        },
      });

      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${ownerTempComment.id}`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Comment deleted successfully');

      const check = await prisma.comment.findUnique({
        where: { id: ownerTempComment.id },
      });
      expect(check).toBeNull();
    });

    it('should return 404 when deleting non-existent comment', async () => {
      const fakeCommentId = randomUUID();
      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${fakeCommentId}`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('COMMENT_NOT_FOUND');
    });
  });
});
