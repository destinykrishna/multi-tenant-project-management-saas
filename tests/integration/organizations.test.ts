import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Organizations Module Integration Tests', () => {
  let userA: { id: string; email: string; token: string };
  let userB: { id: string; email: string; token: string };
  let userC: { id: string; email: string; token: string };
  let userViewer: { id: string; email: string; token: string };

  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    // 1. Create test users
    const createdUsers = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Org User A',
          email: `org.user.a.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org User B',
          email: `org.user.b.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org User C',
          email: `org.user.c.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org Viewer User',
          email: `org.viewer.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
    ]);

    userA = {
      id: createdUsers[0].id,
      email: createdUsers[0].email,
      token: generateAccessToken({ userId: createdUsers[0].id, email: createdUsers[0].email }),
    };

    userB = {
      id: createdUsers[1].id,
      email: createdUsers[1].email,
      token: generateAccessToken({ userId: createdUsers[1].id, email: createdUsers[1].email }),
    };

    userC = {
      id: createdUsers[2].id,
      email: createdUsers[2].email,
      token: generateAccessToken({ userId: createdUsers[2].id, email: createdUsers[2].email }),
    };

    userViewer = {
      id: createdUsers[3].id,
      email: createdUsers[3].email,
      token: generateAccessToken({ userId: createdUsers[3].id, email: createdUsers[3].email }),
    };
  });

  afterAll(async () => {
    // Cleanup organizations and users
    if (orgAId || orgBId) {
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId].filter(Boolean) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgAId, orgBId].filter(Boolean) } },
      });
    }

    const userIds = [userA?.id, userB?.id, userC?.id, userViewer?.id].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.organizationMember.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.organization.deleteMany({ where: { ownerId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await disconnectDatabase();
  });

  describe('POST /api/v1/organizations', () => {
    it('should require authentication (401)', async () => {
      const res = await request(app)
        .post('/api/v1/organizations')
        .send({ name: 'Acme Corp' })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_HEADER_REQUIRED');
    });

    it('should create an organization, assign user as OWNER, and return 201', async () => {
      const res = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Apex Innovations', slug: `apex-${randomUUID().slice(0, 8)}` })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Apex Innovations');
      expect(res.body.data.ownerId).toBe(userA.id);
      expect(res.body.data.role).toBe('OWNER');

      orgAId = res.body.data.id;

      // Verify membership in database
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgAId,
            userId: userA.id,
          },
        },
      });

      expect(member).toBeDefined();
      expect(member?.role).toBe('OWNER');
    });

    it('should auto-generate unique slug if not provided', async () => {
      const res = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'Beta Systems' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.slug).toMatch(/^beta-systems/);

      orgBId = res.body.data.id;
    });

    it('should reject duplicate custom slug with 409 Conflict', async () => {
      const customSlug = `unique-slug-${randomUUID().slice(0, 8)}`;

      // First creation
      await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'First Org', slug: customSlug })
        .expect(201);

      // Duplicate creation attempt
      const res = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'Second Org', slug: customSlug })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SLUG_ALREADY_EXISTS');
    });

    it('should reject invalid input payload with 422 Validation Error', async () => {
      const res = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: '' })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/organizations', () => {
    it('should list only organizations that the authenticated user belongs to', async () => {
      const res = await request(app)
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const orgIds = res.body.data.map((o: { id: string }) => o.id);
      expect(orgIds).toContain(orgAId);
      expect(orgIds).not.toContain(orgBId); // User A does not belong to Org B
    });
  });

  describe('GET /api/v1/organizations/:id', () => {
    it('should allow organization members to view organization details (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(orgAId);
      expect(res.body.data.name).toBe('Apex Innovations');
      expect(res.body.data.role).toBe('OWNER');
      expect(res.body.data._count).toBeDefined();
    });

    it('should forbid non-members from accessing another organization (403 Cross-Org Access Denial)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userC.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject invalid UUID param with 422 Validation Error', async () => {
      const res = await request(app)
        .get('/api/v1/organizations/not-a-valid-uuid')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/v1/organizations/:id', () => {
    beforeAll(async () => {
      // Add User B as MEMBER and UserViewer as VIEWER to Org A
      await prisma.organizationMember.createMany({
        data: [
          { organizationId: orgAId, userId: userB.id, role: 'MEMBER' },
          { organizationId: orgAId, userId: userViewer.id, role: 'VIEWER' },
        ],
      });
    });

    it('should allow OWNER to update organization name and slug (200)', async () => {
      const newName = 'Apex Global Technologies';
      const newSlug = `apex-global-${randomUUID().slice(0, 8)}`;

      const res = await request(app)
        .patch(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: newName, slug: newSlug })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(newName);
      expect(res.body.data.slug).toBe(newSlug);
    });

    it('should reject MEMBER from updating organization (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'Hacked Name' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject VIEWER from updating organization (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userViewer.token}`)
        .send({ name: 'Viewer Hacked Name' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject non-members from updating organization (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userC.token}`)
        .send({ name: 'NonMember Name' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });

  describe('DELETE /api/v1/organizations/:id', () => {
    let orgToDeleteId: string;

    beforeEach(async () => {
      // Create a temporary org for deletion
      const tempOrg = await prisma.organization.create({
        data: {
          name: 'Temporary Org',
          slug: `temp-org-${randomUUID()}`,
          ownerId: userA.id,
        },
      });
      orgToDeleteId = tempOrg.id;

      await prisma.organizationMember.createMany({
        data: [
          { organizationId: orgToDeleteId, userId: userA.id, role: 'OWNER' },
          { organizationId: orgToDeleteId, userId: userB.id, role: 'ADMIN' },
          { organizationId: orgToDeleteId, userId: userViewer.id, role: 'VIEWER' },
        ],
      });
    });

    it('should reject non-members from deleting organization (403 Cross-Org Denial)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgToDeleteId}`)
        .set('Authorization', `Bearer ${userC.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject VIEWER from deleting organization (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgToDeleteId}`)
        .set('Authorization', `Bearer ${userViewer.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject ADMIN from deleting organization (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgToDeleteId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow OWNER to delete organization (200)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgToDeleteId}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Organization deleted successfully');

      // Verify deletion from database
      const check = await prisma.organization.findUnique({
        where: { id: orgToDeleteId },
      });
      expect(check).toBeNull();
    });
  });
});
