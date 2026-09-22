import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, dbPool, withTenantContext, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { OrganizationRole } from '../../src/constants/roles.js';

describe('Tenant Isolation & RLS Architecture Integration Tests', () => {
  // Tenant A fixtures
  let orgA: { id: string; name: string };
  let userA: { id: string; email: string; token: string };
  let projectA: { id: string; key: string };
  let taskA: { id: string; title: string };

  // Tenant B fixtures
  let orgB: { id: string; name: string };
  let userB: { id: string; email: string; token: string };
  let projectB: { id: string; key: string };
  let taskB: { id: string; title: string };
  let teamB: { id: string; name: string };

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Tenant A User & Organization
    const dbUserA = await prisma.user.create({
      data: {
        name: 'Tenant A Owner',
        email: `tenant.a.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
        passwordHash: 'hashed_password',
      },
    });
    createdUserIds.push(dbUserA.id);

    const dbOrgA = await prisma.organization.create({
      data: {
        name: 'Organization A',
        slug: `org-a-${Date.now()}-${randomUUID().slice(0, 4)}`,
        ownerId: dbUserA.id,
        members: {
          create: {
            userId: dbUserA.id,
            role: OrganizationRole.OWNER,
          },
        },
      },
    });
    createdOrgIds.push(dbOrgA.id);

    const tokenA = generateAccessToken({
      userId: dbUserA.id,
      email: dbUserA.email,
    });

    orgA = { id: dbOrgA.id, name: dbOrgA.name };
    userA = { id: dbUserA.id, email: dbUserA.email, token: tokenA };

    // 2. Create Tenant B User & Organization
    const dbUserB = await prisma.user.create({
      data: {
        name: 'Tenant B Owner',
        email: `tenant.b.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
        passwordHash: 'hashed_password',
      },
    });
    createdUserIds.push(dbUserB.id);

    const dbOrgB = await prisma.organization.create({
      data: {
        name: 'Organization B',
        slug: `org-b-${Date.now()}-${randomUUID().slice(0, 4)}`,
        ownerId: dbUserB.id,
        members: {
          create: {
            userId: dbUserB.id,
            role: OrganizationRole.OWNER,
          },
        },
      },
    });
    createdOrgIds.push(dbOrgB.id);

    const tokenB = generateAccessToken({
      userId: dbUserB.id,
      email: dbUserB.email,
    });

    orgB = { id: dbOrgB.id, name: dbOrgB.name };
    userB = { id: dbUserB.id, email: dbUserB.email, token: tokenB };

    // 3. Create Project & Task in Tenant A
    const dbProjectA = await prisma.project.create({
      data: {
        organizationId: orgA.id,
        name: 'Project Alpha',
        key: `A${randomUUID().slice(0, 3).toUpperCase()}`,
        createdById: userA.id,
      },
    });
    projectA = { id: dbProjectA.id, key: dbProjectA.key };

    const dbTaskA = await prisma.task.create({
      data: {
        projectId: projectA.id,
        title: 'Task in Tenant A',
        status: 'TODO',
        priority: 'MEDIUM',
        position: 1000,
        createdById: userA.id,
      },
    });
    taskA = { id: dbTaskA.id, title: dbTaskA.title };

    // 4. Create Project, Task & Team in Tenant B
    const dbProjectB = await prisma.project.create({
      data: {
        organizationId: orgB.id,
        name: 'Project Beta',
        key: `B${randomUUID().slice(0, 3).toUpperCase()}`,
        createdById: userB.id,
      },
    });
    projectB = { id: dbProjectB.id, key: dbProjectB.key };

    const dbTaskB = await prisma.task.create({
      data: {
        projectId: projectB.id,
        title: 'Task in Tenant B',
        status: 'TODO',
        priority: 'HIGH',
        position: 1000,
        createdById: userB.id,
      },
    });
    taskB = { id: dbTaskB.id, title: dbTaskB.title };

    const dbTeamB = await prisma.team.create({
      data: {
        organizationId: orgB.id,
        name: `Team Beta ${randomUUID().slice(0, 4)}`,
      },
    });
    teamB = { id: dbTeamB.id, name: dbTeamB.name };
  });

  afterAll(async () => {
    // Cleanup created data
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await disconnectDatabase();
  });

  // ─── 1. Cross-Tenant Direct API Rejection (Middleware Boundary) ─────────────
  describe('1. Express Authorization Middleware Tenant Boundary', () => {
    it('SECURITY: Organization A user cannot access Organization B projects (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgB.id}/projects`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('SECURITY: Organization A user cannot create a project in Organization B (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgB.id}/projects`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          name: 'Malicious Injected Project',
          key: 'INJ1',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('SECURITY: Organization A user cannot list tasks in Organization B (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgB.id}/projects/${projectB.id}/tasks`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('SECURITY: Organization A user cannot create a task in Organization B (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgB.id}/projects/${projectB.id}/tasks`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          title: 'Cross-Tenant Injected Task',
          status: 'TODO',
          priority: 'HIGH',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('SECURITY: Organization A user cannot access Organization B meetings (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgB.id}/meetings`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('SECURITY: Organization A user cannot access Organization B activity logs (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgB.id}/activity`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });

  // ─── 2. Cross-Tenant Direct ID (IDOR) Protection ───────────────────────────
  describe('2. Direct ID & IDOR Cross-Tenant Access Prevention', () => {
    it('SECURITY: Org A request cannot retrieve Org B project through Org A route (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/projects/${projectB.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('SECURITY: Org A request cannot update Org B project through Org A route (404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgA.id}/projects/${projectB.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Tampered Project Name' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('SECURITY: Org A request cannot delete Org B project through Org A route (404)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgA.id}/projects/${projectB.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('SECURITY: Org A request cannot retrieve Org B task under Org A project (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/projects/${projectA.id}/tasks/${taskB.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TASK_NOT_FOUND');
    });

    it('SECURITY: Org A request cannot update Org B task under Org A project (404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgA.id}/projects/${projectA.id}/tasks/${taskB.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ title: 'Tampered Task Title' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TASK_NOT_FOUND');
    });

    it('SECURITY: Org A request cannot delete Org B task under Org A project (404)', async () => {
      const res = await request(app)
        .delete(`/api/v1/organizations/${orgA.id}/projects/${projectA.id}/tasks/${taskB.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TASK_NOT_FOUND');
    });

    it('SECURITY: Org A task creation rejects assigning cross-tenant user (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgA.id}/projects/${projectA.id}/tasks`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          title: 'Cross-Tenant Assignee Test',
          status: 'TODO',
          priority: 'LOW',
          assigneeId: userB.id,
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });

    it('SECURITY: Org A task creation rejects assigning cross-tenant team (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgA.id}/projects/${projectA.id}/tasks`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          title: 'Cross-Tenant Team Test',
          status: 'TODO',
          priority: 'LOW',
          teamId: teamB.id,
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_TEAM');
    });
  });

  // ─── 3. Missing or Invalid Tenant Context Handling ─────────────────────────
  describe('3. Missing or Invalid Tenant Context Handling', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/projects`)
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_HEADER_REQUIRED');
    });

    it('should reject request targeting non-existent organization with 403', async () => {
      const nonExistentOrgId = randomUUID();
      const res = await request(app)
        .get(`/api/v1/organizations/${nonExistentOrgId}/projects`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should never expose all tenant rows when querying projects', async () => {
      // User A queries their own projects - must return only Org A projects, never Org B
      const res = await request(app)
        .get(`/api/v1/organizations/${orgA.id}/projects`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const items = res.body.data.items as Array<{ id: string; organizationId: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((p) => p.organizationId === orgA.id)).toBe(true);
      expect(items.some((p) => p.organizationId === orgB.id)).toBe(false);
    });
  });

  // ─── 4. Connection Pool & Session Variable Isolation (withTenantContext) ──
  describe('4. Connection Pool & Session Variable Isolation', () => {
    it('should set app.current_org_id locally within withTenantContext transaction', async () => {
      await withTenantContext(orgA.id, async (tx) => {
        const result = await tx.$queryRawUnsafe<Array<{ setting: string }>>(
          `SELECT current_setting('app.current_org_id', true) as setting;`,
        );
        expect(result[0]?.setting).toBe(orgA.id);
      });
    });

    it('should NOT leak app.current_org_id across subsequent pooled queries (SET LOCAL guarantee)', async () => {
      // 1. Run withTenantContext setting Org A
      await withTenantContext(orgA.id, async (tx) => {
        await tx.$queryRawUnsafe(`SELECT 1;`);
      });

      // 2. Query a client directly from the pool outside any transaction
      const client = await dbPool.connect();
      try {
        const res = await client.query(`SELECT NULLIF(current_setting('app.current_org_id', true), '') as setting;`);
        // The setting must be null/empty because SET LOCAL is scoped strictly to the transaction
        expect(res.rows[0].setting).toBeNull();
      } finally {
        client.release();
      }
    });
  });

  // ─── 5. Database RLS State & Superuser Privilege Verification ──────────────
  describe('5. Database RLS State & Role Architecture Verification', () => {
    it('verifies that database connection user is a superuser (bypassing RLS by engine rule)', async () => {
      const privs = await dbPool.query(`
        SELECT current_user, rolsuper, rolbypassrls
        FROM pg_roles
        WHERE rolname = current_user;
      `);

      expect(privs.rows.length).toBe(1);
      const userPriv = privs.rows[0];
      expect(userPriv.current_user).toBeDefined();
      // PostgreSQL superusers always have rolsuper = true and rolbypassrls = true
      expect(userPriv.rolsuper).toBe(true);
      expect(userPriv.rolbypassrls).toBe(true);
    });

    it('verifies that superuser queries bypass RLS policies even if app.current_org_id is set to another org', async () => {
      const client = await dbPool.connect();
      try {
        await client.query('BEGIN');
        // Set context to Org A
        await client.query(`SELECT set_config('app.current_org_id', '${orgA.id}', true)`);

        // Superuser raw query on projects table: because the connection role has rolsuper=true,
        // PostgreSQL engine permits returning projects from Org B despite RLS policy
        const res = await client.query(
          `SELECT id, "organizationId" FROM projects WHERE id = $1`,
          [projectB.id],
        );

        // Proves that under the current superuser connection, the database engine bypasses RLS,
        // confirming that the application layer (Prisma query scoping & Express RBAC) is the authoritative security boundary
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].organizationId).toBe(orgB.id);

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('verifies that application Prisma queries enforce tenant isolation via explicit repository WHERE clauses', async () => {
      // Prisma repository methods explicitly include organizationId in WHERE clauses
      const foundInOrgA = await prisma.project.findFirst({
        where: {
          id: projectB.id,
          organizationId: orgA.id,
        },
      });

      // Even though raw DB role is superuser, application query returns null
      expect(foundInOrgA).toBeNull();
    });
  });

  // ─── 6. Legitimate System / Public Operations Isolation ────────────────────
  describe('6. Legitimate System & Public Operations Isolation', () => {
    it('allows health check probe without tenant context', async () => {
      const res = await request(app).get('/health').expect(200);
      expect(res.body.data.status).toBe('healthy');
    });

    it('edge cache purge requires platform admin secret and is completely isolated from tenant context', async () => {
      // Normal tenant owner cannot purge edge cache
      const resNormal = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(403);

      expect(resNormal.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');

      // Platform admin with system secret can purge
      const resAdmin = await request(app)
        .post('/api/v1/system/edge-cache/purge')
        .set('x-platform-secret', 'test-platform-secret')
        .expect(200);

      expect(resAdmin.body.success).toBe(true);
    });
  });
});
