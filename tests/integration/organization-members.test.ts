import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Organization Member Management Integration Tests', () => {
  let ownerUser: { id: string; email: string; token: string };
  let adminUser: { id: string; email: string; token: string };
  let memberUser: { id: string; email: string; token: string };
  let viewerUser: { id: string; email: string; token: string };
  let candidateUser: { id: string; email: string };
  let nonMemberUser: { id: string; email: string; token: string };
  let secondAdminUser: { id: string; email: string; token: string };

  let orgId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Create users
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Owner User',
          email: `mem.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Admin User',
          email: `mem.admin.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Member User',
          email: `mem.member.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Viewer User',
          email: `mem.viewer.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Candidate User',
          email: `mem.candidate.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'NonMember User',
          email: `mem.nonmember.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Second Admin User',
          email: `mem.admin2.${Date.now()}@example.com`,
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

    candidateUser = {
      id: users[4].id,
      email: users[4].email,
    };

    nonMemberUser = {
      id: users[5].id,
      email: users[5].email,
      token: generateAccessToken({ userId: users[5].id, email: users[5].email }),
    };

    secondAdminUser = {
      id: users[6].id,
      email: users[6].email,
      token: generateAccessToken({ userId: users[6].id, email: users[6].email }),
    };

    // 2. Create Organization
    const organization = await prisma.organization.create({
      data: {
        name: 'Member Management Org',
        slug: `mem-org-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    orgId = organization.id;

    // 3. Create initial memberships
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgId, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: orgId, userId: adminUser.id, role: 'ADMIN' },
        { organizationId: orgId, userId: memberUser.id, role: 'MEMBER' },
        { organizationId: orgId, userId: viewerUser.id, role: 'VIEWER' },
        { organizationId: orgId, userId: secondAdminUser.id, role: 'ADMIN' },
      ],
    });
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    await disconnectDatabase();
  });

  describe('GET /api/v1/organizations/:id/members', () => {
    it('should allow members to list all organization members with safe user details (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(4);

      // Verify safe user details (no passwordHash)
      const firstMember = res.body.data[0];
      expect(firstMember.user).toBeDefined();
      expect(firstMember.user.email).toBeDefined();
      expect(firstMember.user.passwordHash).toBeUndefined();
      expect(firstMember.role).toBeDefined();
    });

    it('should forbid non-members from listing members (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${nonMemberUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });

  describe('POST /api/v1/organizations/:id/members', () => {
    it('should create a pending invitation when ADMIN invites a user without forcing membership (201)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          email: candidateUser.email,
          role: 'MEMBER',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isPending).toBe(true);
      expect(res.body.data.role).toBe('MEMBER');
      expect(res.body.data.user.email).toBe(candidateUser.email);

      // Explicitly create membership for subsequent role update/removal tests
      await prisma.organizationMember.create({
        data: {
          organizationId: orgId,
          userId: candidateUser.id,
          role: 'MEMBER',
        },
      });
    });

    it('should reject duplicate member addition (409 Conflict)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          email: candidateUser.email,
          role: 'VIEWER',
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MEMBER_ALREADY_EXISTS');
    });

    it('should forbid regular MEMBER from adding members (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          email: nonMemberUser.email,
          role: 'VIEWER',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should create a pending invitation when inviting a non-existent email (201)', async () => {
      const inviteEmail = `does.not.exist.${Date.now()}.${randomUUID()}@example.com`;
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          email: inviteEmail,
          role: 'MEMBER',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isPending).toBe(true);
      expect(res.body.data.user.email).toBe(inviteEmail);
    });
  });

  describe('PATCH /api/v1/organizations/:id/members/:userId', () => {
    it('should forbid ADMIN from modifying another ADMIN role (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgId}/members/${secondAdminUser.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'MEMBER' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should forbid ADMIN from promoting someone to ADMIN (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgId}/members/${candidateUser.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'ADMIN' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow OWNER to update a member role (200)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgId}/members/${candidateUser.id}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({ role: 'ADMIN' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('ADMIN');
    });

    it('should forbid modifying the OWNER role (400 Bad Request)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgId}/members/${ownerUser.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'MEMBER' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER_ROLE');
    });

    it('should forbid regular MEMBER from modifying roles (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgId}/members/${candidateUser.id}`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({ role: 'VIEWER' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('DELETE /api/v1/organizations/:id/members/:userId', () => {
    it('should forbid ADMIN from removing another ADMIN (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgId}/members/${secondAdminUser.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should forbid regular MEMBER from removing a member (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgId}/members/${candidateUser.id}`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should forbid removing the OWNER (400 Bad Request)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgId}/members/${ownerUser.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CANNOT_REMOVE_OWNER');
    });

    it('should allow OWNER to remove an ADMIN (200)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgId}/members/${secondAdminUser.id}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Member removed successfully');
    });

    it('should allow ADMIN to remove a non-admin member (200)', async () => {
      // Set candidateUser back to MEMBER
      await prisma.organizationMember.update({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: candidateUser.id,
          },
        },
        data: { role: 'MEMBER' },
      });

      const res = await request(app)
        .delete(`/api/v1/organizations/${orgId}/members/${candidateUser.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Member removed successfully');

      // Verify member is removed
      const check = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: candidateUser.id,
          },
        },
      });
      expect(check).toBeNull();
    });
  });
});
