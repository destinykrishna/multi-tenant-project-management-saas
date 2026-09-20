import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';

describe('Task Assignment & Teams Integration Tests', () => {
  let ownerOrg1: { id: string; email: string; token: string };
  let adminOrg1: { id: string; email: string; token: string };
  let memberOrg1: { id: string; email: string; token: string };
  let member2Org1: { id: string; email: string; token: string };
  let viewerOrg1: { id: string; email: string; token: string };

  let ownerOrg2: { id: string; email: string; token: string };
  let memberOrg2: { id: string; email: string; token: string };

  let org1Id: string;
  let org2Id: string;
  let project1Id: string;
  let project2Id: string;

  let team1Org1Id: string;
  let team2Org1Id: string;
  let teamOrg2Id: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Create users
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Task Owner Org1',
          email: `tsk.owner.org1.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Admin Org1',
          email: `tsk.admin.org1.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Member Org1',
          email: `tsk.mem1.org1.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Member2 Org1',
          email: `tsk.mem2.org1.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Viewer Org1',
          email: `tsk.view.org1.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Owner Org2',
          email: `tsk.owner.org2.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Task Member Org2',
          email: `tsk.mem.org2.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
    ]);

    users.forEach((u) => createdUserIds.push(u.id));

    ownerOrg1 = {
      id: users[0].id,
      email: users[0].email,
      token: generateAccessToken({ userId: users[0].id, email: users[0].email }),
    };
    adminOrg1 = {
      id: users[1].id,
      email: users[1].email,
      token: generateAccessToken({ userId: users[1].id, email: users[1].email }),
    };
    memberOrg1 = {
      id: users[2].id,
      email: users[2].email,
      token: generateAccessToken({ userId: users[2].id, email: users[2].email }),
    };
    member2Org1 = {
      id: users[3].id,
      email: users[3].email,
      token: generateAccessToken({ userId: users[3].id, email: users[3].email }),
    };
    viewerOrg1 = {
      id: users[4].id,
      email: users[4].email,
      token: generateAccessToken({ userId: users[4].id, email: users[4].email }),
    };

    ownerOrg2 = {
      id: users[5].id,
      email: users[5].email,
      token: generateAccessToken({ userId: users[5].id, email: users[5].email }),
    };
    memberOrg2 = {
      id: users[6].id,
      email: users[6].email,
      token: generateAccessToken({ userId: users[6].id, email: users[6].email }),
    };

    // 2. Create Organizations
    const org1 = await prisma.organization.create({
      data: {
        name: 'Assignment Test Org 1',
        slug: `asgn-org-1-${randomUUID()}`,
        ownerId: ownerOrg1.id,
      },
    });
    org1Id = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        name: 'Assignment Test Org 2',
        slug: `asgn-org-2-${randomUUID()}`,
        ownerId: ownerOrg2.id,
      },
    });
    org2Id = org2.id;

    // 3. Organization Memberships
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org1Id, userId: ownerOrg1.id, role: 'OWNER' },
        { organizationId: org1Id, userId: adminOrg1.id, role: 'ADMIN' },
        { organizationId: org1Id, userId: memberOrg1.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: member2Org1.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: viewerOrg1.id, role: 'VIEWER' },
        { organizationId: org2Id, userId: ownerOrg2.id, role: 'OWNER' },
        { organizationId: org2Id, userId: memberOrg2.id, role: 'MEMBER' },
      ],
    });

    // 4. Create Projects
    const proj1 = await prisma.project.create({
      data: {
        organizationId: org1Id,
        name: 'Project 1 Org 1',
        key: 'P1O1',
        createdById: ownerOrg1.id,
      },
    });
    project1Id = proj1.id;

    const proj2 = await prisma.project.create({
      data: {
        organizationId: org2Id,
        name: 'Project 1 Org 2',
        key: 'P1O2',
        createdById: ownerOrg2.id,
      },
    });
    project2Id = proj2.id;

    // 5. Create Teams
    const team1 = await prisma.team.create({
      data: {
        organizationId: org1Id,
        name: 'Frontend Engineering',
        description: 'Web and mobile developers',
        members: {
          create: [{ userId: memberOrg1.id }, { userId: member2Org1.id }],
        },
      },
    });
    team1Org1Id = team1.id;

    const team2 = await prisma.team.create({
      data: {
        organizationId: org1Id,
        name: 'Backend Engineering',
        description: 'Distributed systems and APIs',
        members: {
          create: [{ userId: memberOrg1.id }],
        },
      },
    });
    team2Org1Id = team2.id;

    const teamOrg2 = await prisma.team.create({
      data: {
        organizationId: org2Id,
        name: 'Org 2 Team',
        description: 'Org 2 core team',
        members: {
          create: [{ userId: memberOrg2.id }],
        },
      },
    });
    teamOrg2Id = teamOrg2.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.task.deleteMany({
      where: { projectId: { in: [project1Id, project2Id] } },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: [team1Org1Id, team2Org1Id, teamOrg2Id] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [team1Org1Id, team2Org1Id, teamOrg2Id] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [project1Id, project2Id] } },
    });
    await prisma.organizationMember.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [org1Id, org2Id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });

    await disconnectDatabase();
  });

  // ==========================================
  // SECTION 1: Teams API
  // ==========================================
  describe('Teams API', () => {
    it('should list teams belonging only to the organization', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/teams`)
        .set('Authorization', `Bearer ${memberOrg1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
      const names = res.body.data.map((t: any) => t.name);
      expect(names).toContain('Frontend Engineering');
      expect(names).toContain('Backend Engineering');
      expect(names).not.toContain('Org 2 Team');
    });

    it('should create a new team with members in the organization', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/teams`)
        .set('Authorization', `Bearer ${adminOrg1.token}`)
        .send({
          name: 'QA & Testing Team',
          description: 'Quality assurance team',
          memberUserIds: [memberOrg1.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('QA & Testing Team');
      expect(res.body.data.members.length).toBe(1);
      expect(res.body.data.members[0].userId).toBe(memberOrg1.id);
    });

    it('should reject creating a team with cross-tenant members (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/teams`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          name: 'Cross Tenant Team',
          memberUserIds: [memberOrg2.id], // Belongs to Org 2
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TEAM_MEMBER');
    });

    it('should reject team creation by VIEWER (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/teams`)
        .set('Authorization', `Bearer ${viewerOrg1.token}`)
        .send({
          name: 'Viewer Team Attempt',
        });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // SECTION 2: Task Creation with Assignment
  // ==========================================
  describe('POST /tasks - Assignment on Create', () => {
    it('should create a task without assignment (unassigned)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          title: 'Unassigned Task',
          priority: 'MEDIUM',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assigneeId).toBeNull();
      expect(res.body.data.teamId).toBeNull();
      expect(res.body.data.assignee).toBeNull();
      expect(res.body.data.team).toBeNull();
    });

    it('should create a task assigned to an individual member', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${memberOrg1.token}`)
        .send({
          title: 'Task Assigned to Member 2',
          assigneeId: member2Org1.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assigneeId).toBe(member2Org1.id);
      expect(res.body.data.assignee.id).toBe(member2Org1.id);
      expect(res.body.data.assignee.name).toBe('Task Member2 Org1');
      expect(res.body.data.teamId).toBeNull();
    });

    it('should create a task assigned to an organization team without duplicating task rows', async () => {
      const beforeCount = await prisma.task.count({ where: { projectId: project1Id } });

      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${adminOrg1.token}`)
        .send({
          title: 'Team Assigned Task',
          teamId: team1Org1Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.teamId).toBe(team1Org1Id);
      expect(res.body.data.team.id).toBe(team1Org1Id);
      expect(res.body.data.team.name).toBe('Frontend Engineering');
      expect(res.body.data.assigneeId).toBeNull();

      // Invariant check: precisely ONE task was created, not duplicated for team members!
      const afterCount = await prisma.task.count({ where: { projectId: project1Id } });
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('should cleanly support assigning BOTH an individual member and a team simultaneously', async () => {
      const beforeCount = await prisma.task.count({ where: { projectId: project1Id } });

      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          title: 'Dual Assigned Task',
          assigneeId: memberOrg1.id,
          teamId: team1Org1Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assigneeId).toBe(memberOrg1.id);
      expect(res.body.data.assignee.name).toBe('Task Member Org1');
      expect(res.body.data.teamId).toBe(team1Org1Id);
      expect(res.body.data.team.name).toBe('Frontend Engineering');

      // Still precisely 1 task
      const afterCount = await prisma.task.count({ where: { projectId: project1Id } });
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('should reject invalid non-existent assignee ID (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          title: 'Task with Fake Assignee',
          assigneeId: randomUUID(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });

    it('should reject invalid non-existent team ID (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          title: 'Task with Fake Team',
          teamId: randomUUID(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TEAM');
    });

    it('SECURITY: should reject cross-tenant assignee attack (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          title: 'Cross-Tenant User Assignee Attack',
          assigneeId: memberOrg2.id, // User belongs to Org 2
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });

    it('SECURITY: should reject cross-tenant team attack (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          title: 'Cross-Tenant Team Attack',
          teamId: teamOrg2Id, // Team belongs to Org 2
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TEAM');
    });
  });

  // ==========================================
  // SECTION 3: Task Updates & Reassignment
  // ==========================================
  describe('PATCH /tasks/:taskId - Reassignment & Clearing', () => {
    let testTaskId: string;

    beforeEach(async () => {
      const task = await prisma.task.create({
        data: {
          projectId: project1Id,
          title: 'Reassignment Test Task',
          createdById: ownerOrg1.id,
          assigneeId: memberOrg1.id,
          teamId: team1Org1Id,
        },
      });
      testTaskId = task.id;
    });

    it('should reassign task to a different team and member', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${memberOrg1.token}`)
        .send({
          assigneeId: member2Org1.id,
          teamId: team2Org1Id,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBe(member2Org1.id);
      expect(res.body.data.teamId).toBe(team2Org1Id);
      expect(res.body.data.assignee.id).toBe(member2Org1.id);
      expect(res.body.data.team.id).toBe(team2Org1Id);
    });

    it('should allow clearing member assignment with null', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${adminOrg1.token}`)
        .send({
          assigneeId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBeNull();
      expect(res.body.data.assignee).toBeNull();
      expect(res.body.data.teamId).toBe(team1Org1Id); // Team preserved
    });

    it('should allow clearing team assignment with null', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${adminOrg1.token}`)
        .send({
          teamId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.teamId).toBeNull();
      expect(res.body.data.team).toBeNull();
      expect(res.body.data.assigneeId).toBe(memberOrg1.id); // Assignee preserved
    });

    it('should allow clearing both assignments simultaneously', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          assigneeId: null,
          teamId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBeNull();
      expect(res.body.data.teamId).toBeNull();
    });

    it('SECURITY: should reject updating to a cross-tenant assignee (400)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          assigneeId: memberOrg2.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });

    it('SECURITY: should reject updating to a cross-tenant team (400)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${ownerOrg1.token}`)
        .send({
          teamId: teamOrg2Id,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TEAM');
    });

    it('RBAC: should reject VIEWER from updating task assignments (403)', async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${viewerOrg1.token}`)
        .send({
          assigneeId: member2Org1.id,
        });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // SECTION 4: Retrieval & Filtering
  // ==========================================
  describe('GET /tasks - Filtering by Team and Assignee', () => {
    let taskTeam1: string;
    let taskTeam2: string;

    beforeAll(async () => {
      const t1 = await prisma.task.create({
        data: {
          projectId: project1Id,
          title: 'Filter Task Team 1',
          createdById: ownerOrg1.id,
          teamId: team1Org1Id,
          assigneeId: memberOrg1.id,
        },
      });
      taskTeam1 = t1.id;

      const t2 = await prisma.task.create({
        data: {
          projectId: project1Id,
          title: 'Filter Task Team 2',
          createdById: ownerOrg1.id,
          teamId: team2Org1Id,
          assigneeId: member2Org1.id,
        },
      });
      taskTeam2 = t2.id;
    });

    it('should filter tasks by teamId', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks?teamId=${team1Org1Id}`)
        .set('Authorization', `Bearer ${viewerOrg1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      res.body.data.items.forEach((task: any) => {
        expect(task.teamId).toBe(team1Org1Id);
      });
    });

    it('should filter tasks by assigneeId', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks?assigneeId=${member2Org1.id}`)
        .set('Authorization', `Bearer ${memberOrg1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      res.body.data.items.forEach((task: any) => {
        expect(task.assigneeId).toBe(member2Org1.id);
      });
    });

    it('should return populated team and assignee objects in task response', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${taskTeam1}`)
        .set('Authorization', `Bearer ${memberOrg1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.team).toBeDefined();
      expect(res.body.data.team.name).toBe('Frontend Engineering');
      expect(res.body.data.assignee).toBeDefined();
      expect(res.body.data.assignee.name).toBe('Task Member Org1');
    });
  });
});
