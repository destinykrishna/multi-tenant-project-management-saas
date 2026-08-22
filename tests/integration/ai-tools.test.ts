import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { toolRegistry } from '../../src/modules/ai/tools/tool-registry.js';
import type { AiRequestContext } from '../../src/modules/ai/ai.types.js';

describe('Safe Read-Only AI Tools Layer', () => {
  let user1Token: string;
  let user1Id: string;
  let org1Id: string;

  let user2Token: string;
  let user2Id: string;
  let org2Id: string;

  let project1Id: string;
  let project2Id: string;
  let task1Id: string;
  let task2Id: string;

  let member1Id: string;
  let member2Id: string;

  const testEmail1 = `ai.tools.org1.${Date.now()}@example.com`;
  const testEmail2 = `ai.tools.org2.${Date.now()}@example.com`;

  beforeAll(async () => {
    // 1. Create User 1 & Org 1
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Tools Org A User',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Tools Organization Alpha',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;
    org1Id = res1.body.data.organization.id;

    // 2. Create User 2 & Org 2
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Tools Org B User',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Tools Organization Beta',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;
    user2Id = res2.body.data.user.id;
    org2Id = res2.body.data.organization.id;

    // 3. Org 1: Project & Task
    const projRes1 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Alpha AI Platform',
        key: 'AIP',
        description: 'Alpha proprietary AI workflow engine',
      })
      .expect(201);
    project1Id = projRes1.body.data.id;

    const taskRes1 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'Optimize Vector Embeddings Pipeline',
        description: 'Reduce inference latency by batching chunks.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
      })
      .expect(201);
    task1Id = taskRes1.body.data.id;

    // 4. Org 2: Project & Task
    const projRes2 = await request(app)
      .post(`/api/v1/organizations/${org2Id}/projects`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        name: 'Beta Secret Vault',
        key: 'BSV',
        description: 'Beta secret proprietary assets',
      })
      .expect(201);
    project2Id = projRes2.body.data.id;

    const taskRes2 = await request(app)
      .post(`/api/v1/organizations/${org2Id}/projects/${project2Id}/tasks`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        title: 'Confidential Beta Audit',
        description: 'Auditing private Swiss accounts.',
        priority: 'URGENT',
        status: 'TODO',
      })
      .expect(201);
    task2Id = taskRes2.body.data.id;

    // 5. Fetch member IDs
    const members1 = await prisma.organizationMember.findMany({ where: { organizationId: org1Id } });
    member1Id = members1[0]!.id;

    const members2 = await prisma.organizationMember.findMany({ where: { organizationId: org2Id } });
    member2Id = members2[0]!.id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [testEmail1, testEmail2] } },
    });

    for (const u of users) {
      await prisma.$transaction([
        prisma.ragKnowledgeDocument.deleteMany({ where: { organization: { ownerId: u.id } } }),
        prisma.meeting.deleteMany({ where: { organization: { ownerId: u.id } } }),
        prisma.comment.deleteMany({ where: { user: { id: u.id } } }),
        prisma.task.deleteMany({ where: { project: { organization: { ownerId: u.id } } } }),
        prisma.project.deleteMany({ where: { organization: { ownerId: u.id } } }),
        prisma.activityLog.deleteMany({ where: { userId: u.id } }),
        prisma.refreshSession.deleteMany({ where: { userId: u.id } }),
        prisma.organizationMember.deleteMany({ where: { userId: u.id } }),
        prisma.organization.deleteMany({ where: { ownerId: u.id } }),
        prisma.user.delete({ where: { id: u.id } }),
      ]);
    }

    await disconnectDatabase();
  });

  describe('Tool Registry Architecture', () => {
    it('should register all 7 approved read-only tools', () => {
      const toolNames = toolRegistry.getAllTools().map((t) => t.name);
      expect(toolNames).toContain('searchProjects');
      expect(toolNames).toContain('getProject');
      expect(toolNames).toContain('searchTasks');
      expect(toolNames).toContain('getTask');
      expect(toolNames).toContain('searchMembers');
      expect(toolNames).toContain('getMember');
      expect(toolNames).toContain('getRecentActivity');
    });

    it('should export compliant JSON schemas for LLM function calling', () => {
      const defs = toolRegistry.getToolDefinitions();
      expect(defs.length).toBe(7);

      for (const def of defs) {
        expect(def.name).toBeDefined();
        expect(def.description).toBeDefined();
        expect(def.parameters.type).toBe('object');
      }
    });

    it('should reject execution when organizationId or userId is missing in context', async () => {
      const res = await toolRegistry.executeTool('searchProjects', { organizationId: '', userId: '', userRole: 'MEMBER' }, {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('Authentication and organization context required');
    });

    it('should reject execution for unrecognized tool names', async () => {
      const context: AiRequestContext = { organizationId: org1Id, userId: user1Id, userRole: 'MEMBER' };
      const res = await toolRegistry.executeTool('deleteAllProjects', context, {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('not recognized');
    });
  });

  describe('Read-Only Tools Execution', () => {
    const getContextOrg1 = (role = 'OWNER'): AiRequestContext => ({
      organizationId: org1Id,
      userId: user1Id,
      userRole: role,
    });

    it('searchProjects: should return list of projects in the organization', async () => {
      const res = await toolRegistry.executeTool('searchProjects', getContextOrg1(), { search: 'Alpha' });
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      expect(Array.isArray(res.data)).toBe(true);
      const projects = res.data as Array<{ name: string; key: string }>;
      expect(projects.length).toBeGreaterThan(0);
      expect(projects[0]?.name).toBe('Alpha AI Platform');
      expect(projects[0]?.key).toBe('AIP');
    });

    it('getProject: should return detailed project info by ID', async () => {
      const res = await toolRegistry.executeTool('getProject', getContextOrg1(), { projectId: project1Id });
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      const project = res.data as { id: string; name: string; key: string };
      expect(project.id).toBe(project1Id);
      expect(project.name).toBe('Alpha AI Platform');
    });

    it('searchTasks: should return tasks filtered by project', async () => {
      const res = await toolRegistry.executeTool('searchTasks', getContextOrg1(), { projectId: project1Id, status: 'IN_PROGRESS' });
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      const tasks = res.data as Array<{ id: string; title: string; status: string }>;
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0]?.title).toBe('Optimize Vector Embeddings Pipeline');
      expect(tasks[0]?.status).toBe('IN_PROGRESS');
    });

    it('getTask: should return detailed task by ID', async () => {
      const res = await toolRegistry.executeTool('getTask', getContextOrg1(), { projectId: project1Id, taskId: task1Id });
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      const task = res.data as { id: string; title: string };
      expect(task.id).toBe(task1Id);
      expect(task.title).toBe('Optimize Vector Embeddings Pipeline');
    });

    it('searchMembers: should return active organization members', async () => {
      const res = await toolRegistry.executeTool('searchMembers', getContextOrg1(), {});
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      const members = res.data as Array<{ name: string; email: string; role: string }>;
      expect(members.length).toBeGreaterThan(0);
      expect(members[0]?.email).toBe(testEmail1);
      expect(members[0]?.role).toBe('OWNER');
    });

    it('getMember: should return specific member info by ID', async () => {
      const res = await toolRegistry.executeTool('getMember', getContextOrg1(), { memberId: member1Id });
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      const member = res.data as { id: string; email: string };
      expect(member.id).toBe(member1Id);
      expect(member.email).toBe(testEmail1);
    });

    it('getRecentActivity: should return recent audit logs', async () => {
      const res = await toolRegistry.executeTool('getRecentActivity', getContextOrg1(), { limit: 5 });
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      expect(Array.isArray(res.data)).toBe(true);
    });
  });

  describe('Multi-Tenant Isolation & Cross-Tenant Attack Defense', () => {
    const getContextOrg1 = (role = 'MEMBER'): AiRequestContext => ({
      organizationId: org1Id,
      userId: user1Id,
      userRole: role,
    });

    it('should NEVER allow Organization A user to get Organization B project', async () => {
      const res = await toolRegistry.executeTool('getProject', getContextOrg1(), { projectId: project2Id });
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('should NEVER allow Organization A user to get Organization B task', async () => {
      const res = await toolRegistry.executeTool('getTask', getContextOrg1(), { projectId: project2Id, taskId: task2Id });
      expect(res.success).toBe(false);
    });

    it('should NEVER allow Organization A user to search tasks in Organization B project', async () => {
      const res = await toolRegistry.executeTool('searchTasks', getContextOrg1(), { projectId: project2Id });
      expect(res.success).toBe(false);
    });

    it('should NEVER allow Organization A user to get Organization B member', async () => {
      const res = await toolRegistry.executeTool('getMember', getContextOrg1(), { memberId: member2Id });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Member not found in this organization');
    });
  });

  describe('Input Validation & Security Boundaries', () => {
    const getContextOrg1 = (role = 'MEMBER'): AiRequestContext => ({
      organizationId: org1Id,
      userId: user1Id,
      userRole: role,
    });

    it('should reject malformed UUIDs with validation error', async () => {
      const res = await toolRegistry.executeTool('getProject', getContextOrg1(), { projectId: 'invalid-uuid-123' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Tool argument validation failed');
    });

    it('should reject excessive limits above maximum allowed (20)', async () => {
      const res = await toolRegistry.executeTool('searchProjects', getContextOrg1(), { limit: 100 });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Tool argument validation failed');
    });

    it('should never expose password hashes, refresh tokens, or session secrets in member tools', async () => {
      const res = await toolRegistry.executeTool('searchMembers', getContextOrg1(), {});
      expect(res.success).toBe(true);

      const jsonString = JSON.stringify(res.data);
      expect(jsonString).not.toContain('password');
      expect(jsonString).not.toContain('passwordHash');
      expect(jsonString).not.toContain('refreshToken');
      expect(jsonString).not.toContain('session');
    });
  });
});
