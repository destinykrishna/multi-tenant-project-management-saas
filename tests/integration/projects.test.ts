import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Projects Module Integration Tests', () => {
  let ownerUser: { id: string; email: string; token: string };
  let adminUser: { id: string; email: string; token: string };
  let memberUser: { id: string; email: string; token: string };
  let viewerUser: { id: string; email: string; token: string };
  let otherOrgOwner: { id: string; email: string; token: string };

  let org1Id: string;
  let org2Id: string;
  let project1Id: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Create users
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Project Owner',
          email: `prj.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Project Admin',
          email: `prj.admin.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Project Member',
          email: `prj.member.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Project Viewer',
          email: `prj.viewer.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Other Org Owner',
          email: `prj.other.${Date.now()}@example.com`,
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

    otherOrgOwner = {
      id: users[4].id,
      email: users[4].email,
      token: generateAccessToken({ userId: users[4].id, email: users[4].email }),
    };

    // 2. Create Organization 1
    const org1 = await prisma.organization.create({
      data: {
        name: 'Project Test Org 1',
        slug: `prj-org-1-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    org1Id = org1.id;

    // 3. Create Organization 2
    const org2 = await prisma.organization.create({
      data: {
        name: 'Project Test Org 2',
        slug: `prj-org-2-${randomUUID()}`,
        ownerId: otherOrgOwner.id,
      },
    });
    org2Id = org2.id;

    // 4. Set memberships in Org 1
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org1Id, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: org1Id, userId: adminUser.id, role: 'ADMIN' },
        { organizationId: org1Id, userId: memberUser.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: viewerUser.id, role: 'VIEWER' },
      ],
    });

    // 5. Set membership in Org 2
    await prisma.organizationMember.create({
      data: {
        organizationId: org2Id,
        userId: otherOrgOwner.id,
        role: 'OWNER',
      },
    });
  });

  afterAll(async () => {
    if (org1Id || org2Id) {
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

  describe('POST /api/v1/organizations/:organizationId/projects', () => {
    it('should allow MEMBER to create a project with unique key and return 201', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          name: 'Core Application',
          key: 'CORE',
          description: 'Primary core platform project',
          status: 'ACTIVE',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Core Application');
      expect(res.body.data.key).toBe('CORE');
      expect(res.body.data.createdById).toBe(memberUser.id);
      expect(res.body.data.status).toBe('ACTIVE');

      project1Id = res.body.data.id;
    });

    it('should auto-generate project key if not provided', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          name: 'Analytics Dashboard',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBeDefined();
      expect(res.body.data.key.length).toBeGreaterThanOrEqual(2);
    });

    it('should reject duplicate key in the SAME organization (409 Conflict)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          name: 'Another Core App',
          key: 'CORE',
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PROJECT_KEY_ALREADY_EXISTS');
    });

    it('should allow identical key in a DIFFERENT organization (tenant isolation)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org2Id}/projects`)
        .set('Authorization', `Bearer ${otherOrgOwner.token}`)
        .send({
          name: 'Org 2 Core App',
          key: 'CORE',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBe('CORE');
      expect(res.body.data.organizationId).toBe(org2Id);
    });

    it('should reject VIEWER from creating a project (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .send({
          name: 'Viewer Project',
          key: 'VIEW',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject non-members from creating projects (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${otherOrgOwner.token}`)
        .send({
          name: 'Intruder Project',
          key: 'INTR',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject invalid payload with empty name (422 Validation Error)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({ name: '', key: 'VALID' })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid key format containing special characters (422 Validation Error)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({ name: 'Special Key Project', key: 'INV@LID' })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid organization ID format on create (422 Validation Error)', async () => {
      const res = await request(app)
        .post('/api/v1/organizations/invalid-uuid-format/projects')
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({ name: 'Valid Project', key: 'VAL' })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/organizations/:organizationId/projects', () => {
    it('should list projects with pagination and metadata for any member including VIEWER (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects?page=1&limit=10`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(10);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter projects by status', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects?status=ACTIVE`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      res.body.data.items.forEach((p: { status: string }) => {
        expect(p.status).toBe('ACTIVE');
      });
    });

    it('should filter projects by search query', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects?search=Core`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items[0].name).toContain('Core');
    });

    it('should forbid non-members from listing projects (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects`)
        .set('Authorization', `Bearer ${otherOrgOwner.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject invalid organization ID format on listing (422 Validation Error)', async () => {
      const res = await request(app)
        .get('/api/v1/organizations/not-a-valid-uuid/projects')
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/organizations/:organizationId/projects/:projectId', () => {
    it('should return project details for member (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(project1Id);
      expect(res.body.data.name).toBe('Core Application');
      expect(res.body.data.key).toBe('CORE');
      expect(res.body.data._count).toBeDefined();
    });

    it('should forbid non-members from accessing project (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}`)
        .set('Authorization', `Bearer ${otherOrgOwner.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should return 404 if project does not exist within the organization', async () => {
      const nonExistentProjectId = randomUUID();
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${nonExistentProjectId}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('should reject invalid projectId format (422 Validation Error)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/invalid-project-id`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/v1/organizations/:organizationId/projects/:projectId', () => {
    it('should allow MEMBER to update project details and archive it (status: ARCHIVED) (200)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          name: 'Core Application v2',
          description: 'Updated core platform description',
          status: 'ARCHIVED',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Core Application v2');
      expect(res.body.data.description).toBe('Updated core platform description');
      expect(res.body.data.status).toBe('ARCHIVED');
    });

    it('should reject empty update body (422 Validation Error)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({})
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject VIEWER from updating project (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .send({ name: 'Hacked Project Name' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject non-members from updating project (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}`)
        .set('Authorization', `Bearer ${otherOrgOwner.token}`)
        .send({ name: 'Intruder Update' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });

  describe('DELETE /api/v1/organizations/:organizationId/projects/:projectId', () => {
    let projectToDeleteId: string;

    beforeEach(async () => {
      // Create temporary project to delete
      const tempProject = await prisma.project.create({
        data: {
          organizationId: org1Id,
          name: 'Temporary Project',
          key: `TMP${randomUUID().slice(0, 4).toUpperCase()}`,
          createdById: ownerUser.id,
        },
      });
      projectToDeleteId = tempProject.id;
    });

    it('should reject regular MEMBER from deleting project (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${org1Id}/projects/${projectToDeleteId}`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject VIEWER from deleting project (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${org1Id}/projects/${projectToDeleteId}`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject non-members from deleting project (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${org1Id}/projects/${projectToDeleteId}`)
        .set('Authorization', `Bearer ${otherOrgOwner.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should allow ADMIN to delete project (200)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${org1Id}/projects/${projectToDeleteId}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Project deleted successfully');

      // Verify deletion from database
      const check = await prisma.project.findUnique({
        where: { id: projectToDeleteId },
      });
      expect(check).toBeNull();
    });

    it('should allow OWNER to delete project (200)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${org1Id}/projects/${projectToDeleteId}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Project deleted successfully');
    });
  });
});
