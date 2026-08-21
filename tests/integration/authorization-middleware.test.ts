import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { authenticate } from '../../src/middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../src/middlewares/authorization.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import { OrganizationRole } from '../../src/constants/roles.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Organization RBAC Middleware (authorizeOrgRole)', () => {
  const app = express();
  app.use(express.json());

  // Test routes
  app.delete(
    '/api/v1/organizations/:organizationId',
    authenticate,
    authorizeOrgRole([OrganizationRole.OWNER]),
    (req, res) => {
      res.json({ success: true, membership: req.membership });
    },
  );

  app.post(
    '/api/v1/organizations/:organizationId/settings',
    authenticate,
    authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN]),
    (req, res) => {
      res.json({ success: true, membership: req.membership });
    },
  );

  app.post(
    '/api/v1/organizations/:organizationId/projects',
    authenticate,
    authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER]),
    (req, res) => {
      res.json({ success: true, membership: req.membership });
    },
  );

  app.get(
    '/api/v1/organizations/:organizationId/dashboard',
    authenticate,
    authorizeOrgRole([
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ]),
    (req, res) => {
      res.json({ success: true, membership: req.membership });
    },
  );

  app.use(errorHandler);

  let orgId: string;
  let ownerToken: string;
  let adminToken: string;
  let memberToken: string;
  let viewerToken: string;
  let nonMemberToken: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Create 5 test users
    const roles = ['owner', 'admin', 'member', 'viewer', 'non-member'];
    const users: Array<{ id: string; email: string }> = [];

    for (const r of roles) {
      const user = await prisma.user.create({
        data: {
          name: `RBAC ${r}`,
          email: `rbac.${r}.${randomUUID()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      });
      createdUserIds.push(user.id);
      users.push({ id: user.id, email: user.email });
    }

    const [owner, admin, member, viewer, nonMember] = users;

    // 2. Generate tokens
    ownerToken = generateAccessToken({ userId: owner!.id, email: owner!.email });
    adminToken = generateAccessToken({ userId: admin!.id, email: admin!.email });
    memberToken = generateAccessToken({ userId: member!.id, email: member!.email });
    viewerToken = generateAccessToken({ userId: viewer!.id, email: viewer!.email });
    nonMemberToken = generateAccessToken({ userId: nonMember!.id, email: nonMember!.email });

    // 3. Create Organization with owner
    const organization = await prisma.organization.create({
      data: {
        name: 'RBAC Test Org',
        slug: `rbac-org-${randomUUID()}`,
        ownerId: owner!.id,
      },
    });
    orgId = organization.id;

    // 4. Create Organization Memberships
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgId, userId: owner!.id, role: 'OWNER' },
        { organizationId: orgId, userId: admin!.id, role: 'ADMIN' },
        { organizationId: orgId, userId: member!.id, role: 'MEMBER' },
        { organizationId: orgId, userId: viewer!.id, role: 'VIEWER' },
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

  it('should reject unauthenticated requests before checking permissions (401)', async () => {
    const response = await request(app)
      .get(`/api/v1/organizations/${orgId}/dashboard`)
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('AUTH_HEADER_REQUIRED');
  });

  it('should reject non-members with 403 NOT_AN_ORGANIZATION_MEMBER', async () => {
    const response = await request(app)
      .get(`/api/v1/organizations/${orgId}/dashboard`)
      .set('Authorization', `Bearer ${nonMemberToken}`)
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
  });

  it('should reject VIEWER from accessing member-level or admin-level endpoints (403)', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('should reject MEMBER from accessing admin-level endpoints (403)', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('should reject ADMIN from accessing owner-only endpoints (403)', async () => {
    const response = await request(app)
      .delete(`/api/v1/organizations/${orgId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('should allow VIEWER to access viewer-permitted endpoints (200)', async () => {
    const response = await request(app)
      .get(`/api/v1/organizations/${orgId}/dashboard`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.membership.role).toBe('VIEWER');
    expect(response.body.membership.organizationId).toBe(orgId);
  });

  it('should allow MEMBER to access member-permitted endpoints (200)', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.membership.role).toBe('MEMBER');
  });

  it('should allow ADMIN to access admin-permitted endpoints (200)', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.membership.role).toBe('ADMIN');
  });

  it('should allow OWNER to access owner-only endpoints (200)', async () => {
    const response = await request(app)
      .delete(`/api/v1/organizations/${orgId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.membership.role).toBe('OWNER');
  });

  it('should ignore any role sent in request body or headers and use database role', async () => {
    // Viewer attempts to pass fake "OWNER" role in body
    const response = await request(app)
      .delete(`/api/v1/organizations/${orgId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ role: 'OWNER' })
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});
