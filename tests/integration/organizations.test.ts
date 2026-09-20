import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Organizations Module Integration Tests', () => {
  let userA: { id: string; email: string; token: string };
  let userB: { id: string; email: string; token: string };
  let userMember: { id: string; email: string; token: string };
  let userViewer: { id: string; email: string; token: string };
  let userC: { id: string; email: string; token: string };

  let orgAId: string;
  let orgBId: string;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    // 1. Create test users
    const createdUsers = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Org User A',
          email: `org.user.a.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org User B',
          email: `org.user.b.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org Member User',
          email: `org.member.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org Viewer User',
          email: `org.viewer.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org User C',
          email: `org.user.c.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
    ]);

    for (const u of createdUsers) {
      createdUserIds.push(u.id);
    }

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

    userMember = {
      id: createdUsers[2].id,
      email: createdUsers[2].email,
      token: generateAccessToken({ userId: createdUsers[2].id, email: createdUsers[2].email }),
    };

    userViewer = {
      id: createdUsers[3].id,
      email: createdUsers[3].email,
      token: generateAccessToken({ userId: createdUsers[3].id, email: createdUsers[3].email }),
    };

    userC = {
      id: createdUsers[4].id,
      email: createdUsers[4].email,
      token: generateAccessToken({ userId: createdUsers[4].id, email: createdUsers[4].email }),
    };
  });

  afterAll(async () => {
    // Cleanup organizations and users
    const allOrgIds = [...createdOrgIds, orgAId, orgBId].filter(Boolean);
    if (allOrgIds.length > 0) {
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: allOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: allOrgIds } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.organizationMember.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.organization.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
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
      createdOrgIds.push(orgAId);

      // Verify membership in database
      const member = await prisma.organizationMember.findUnique({
        where: {
          userId: userA.id,
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
      createdOrgIds.push(orgBId);
    });

    it('should reject duplicate custom slug with 409 Conflict', async () => {
      const customSlug = `unique-slug-${randomUUID().slice(0, 8)}`;

      const slugUser1 = await prisma.user.create({
        data: {
          name: 'Slug User 1',
          email: `slug1.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
          passwordHash: 'dummy',
        },
      });
      const slugUser2 = await prisma.user.create({
        data: {
          name: 'Slug User 2',
          email: `slug2.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
          passwordHash: 'dummy',
        },
      });
      createdUserIds.push(slugUser1.id, slugUser2.id);

      const token1 = generateAccessToken({ userId: slugUser1.id, email: slugUser1.email });
      const token2 = generateAccessToken({ userId: slugUser2.id, email: slugUser2.email });

      // First creation
      const res1 = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'First Org', slug: customSlug })
        .expect(201);

      createdOrgIds.push(res1.body.data.id);

      // Duplicate creation attempt
      const res2 = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${token2}`)
        .send({ name: 'Second Org', slug: customSlug })
        .expect(409);

      expect(res2.body.success).toBe(false);
      expect(res2.body.error.code).toBe('SLUG_ALREADY_EXISTS');
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
      // Add dedicated UserMember as MEMBER and UserViewer as VIEWER to Org A
      await prisma.organizationMember.createMany({
        data: [
          { organizationId: orgAId, userId: userMember.id, role: 'MEMBER' },
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
        .set('Authorization', `Bearer ${userMember.token}`)
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
    let tempOwner: { id: string; email: string; token: string };
    let tempAdmin: { id: string; email: string; token: string };
    let tempViewer: { id: string; email: string; token: string };

    beforeEach(async () => {
      const [uOwner, uAdmin, uViewer] = await Promise.all([
        prisma.user.create({
          data: {
            name: 'Temp Owner',
            email: `temp.owner.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
            passwordHash: 'dummy',
          },
        }),
        prisma.user.create({
          data: {
            name: 'Temp Admin',
            email: `temp.admin.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
            passwordHash: 'dummy',
          },
        }),
        prisma.user.create({
          data: {
            name: 'Temp Viewer',
            email: `temp.viewer.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
            passwordHash: 'dummy',
          },
        }),
      ]);

      createdUserIds.push(uOwner.id, uAdmin.id, uViewer.id);
      tempOwner = { id: uOwner.id, email: uOwner.email, token: generateAccessToken({ userId: uOwner.id, email: uOwner.email }) };
      tempAdmin = { id: uAdmin.id, email: uAdmin.email, token: generateAccessToken({ userId: uAdmin.id, email: uAdmin.email }) };
      tempViewer = { id: uViewer.id, email: uViewer.email, token: generateAccessToken({ userId: uViewer.id, email: uViewer.email }) };

      // Create a temporary org for deletion with separate users
      const tempOrg = await prisma.organization.create({
        data: {
          name: 'Temporary Org',
          slug: `temp-org-${randomUUID()}`,
          ownerId: tempOwner.id,
        },
      });
      orgToDeleteId = tempOrg.id;
      createdOrgIds.push(tempOrg.id);

      await prisma.organizationMember.createMany({
        data: [
          { organizationId: orgToDeleteId, userId: tempOwner.id, role: 'OWNER' },
          { organizationId: orgToDeleteId, userId: tempAdmin.id, role: 'ADMIN' },
          { organizationId: orgToDeleteId, userId: tempViewer.id, role: 'VIEWER' },
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
        .set('Authorization', `Bearer ${tempViewer.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should reject ADMIN from deleting organization (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgToDeleteId}`)
        .set('Authorization', `Bearer ${tempAdmin.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow OWNER to delete organization (200)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgToDeleteId}`)
        .set('Authorization', `Bearer ${tempOwner.token}`)
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
