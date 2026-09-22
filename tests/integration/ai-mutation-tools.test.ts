import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { hashPassword } from '../../src/utils/password.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { AgentOrchestrator } from '../../src/modules/ai/agent.orchestrator.js';
import { MockAiLlmProvider } from '../../src/modules/ai/providers/mock-llm.provider.js';
import { toolRegistry } from '../../src/modules/ai/tools/tool-registry.js';
import { ragService } from '../../src/modules/rag/rag.service.js';
import { ActivityAction, EntityType } from '../../src/constants/activity.js';
import type { AiRequestContext } from '../../src/modules/ai/ai.types.js';

describe('Controlled Task Mutation Tools Layer', () => {
  let user1Token: string;
  let user1Id: string;
  let org1Id: string;

  let user2Token: string;
  let user2Id: string;
  let org2Id: string;

  let viewerToken: string;
  let viewerUserId: string;

  let rahulUserId: string;
  let project1Id: string;
  let project2Id: string;
  let task1Id: string;
  let task2Id: string;

  const testEmail1 = `mut.owner.org1.${Date.now()}@example.com`;
  const testEmail2 = `mut.owner.org2.${Date.now()}@example.com`;
  const viewerEmail = `mut.viewer.org1.${Date.now()}@example.com`;
  const rahulEmail = `mut.rahul.org1.${Date.now()}@example.com`;

  beforeAll(async () => {
    // 1. Create Org 1 Owner
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Mutation Org A Owner',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Mutation Test Alpha Org',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;
    org1Id = res1.body.data.organization.id;

    // 2. Create Org 2 Owner
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Mutation Org B Owner',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Mutation Test Beta Org',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;
    user2Id = res2.body.data.user.id;
    org2Id = res2.body.data.organization.id;

    // 3. Create Viewer User directly without an initial org & Add to Org 1 as VIEWER
    const passwordHash = await hashPassword('Password123!');
    const viewerUser = await prisma.user.create({
      data: {
        name: 'Org A Viewer',
        email: viewerEmail,
        passwordHash,
        isEmailVerified: true,
      },
    });

    viewerUserId = viewerUser.id;
    viewerToken = generateAccessToken({ userId: viewerUser.id, email: viewerUser.email });

    await prisma.organizationMember.create({
      data: {
        organizationId: org1Id,
        userId: viewerUserId,
        role: 'VIEWER',
      },
    });

    // 4. Create Rahul directly without an initial org & Add to Org 1 as MEMBER
    const rahulUser = await prisma.user.create({
      data: {
        name: 'Rahul Sharma',
        email: rahulEmail,
        passwordHash,
        isEmailVerified: true,
      },
    });

    rahulUserId = rahulUser.id;

    await prisma.organizationMember.create({
      data: {
        organizationId: org1Id,
        userId: rahulUserId,
        role: 'MEMBER',
      },
    });

    // 5. Create Projects in Org 1 and Org 2
    const projRes1 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Core Platform Engine',
        key: 'CPE',
        description: 'Core platform systems',
      })
      .expect(201);
    project1Id = projRes1.body.data.id;

    const projRes2 = await request(app)
      .post(`/api/v1/organizations/${org2Id}/projects`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        name: 'Beta Protected Project',
        key: 'BPP',
        description: 'Beta secret project',
      })
      .expect(201);
    project2Id = projRes2.body.data.id;

    // 6. Create Task 1 in Org 1 and Task 2 in Org 2
    const taskRes1 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'Initial Alpha Task',
        priority: 'MEDIUM',
        status: 'TODO',
      })
      .expect(201);
    task1Id = taskRes1.body.data.id;

    const taskRes2 = await request(app)
      .post(`/api/v1/organizations/${org2Id}/projects/${project2Id}/tasks`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        title: 'Initial Beta Secret Task',
        priority: 'URGENT',
        status: 'TODO',
      })
      .expect(201);
    task2Id = taskRes2.body.data.id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [testEmail1, testEmail2, viewerEmail, rahulEmail] } },
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
  });

  const getContextOrg1 = (role = 'OWNER', userId = user1Id): AiRequestContext => ({
    organizationId: org1Id,
    userId,
    userRole: role,
  });

  describe('createTask Tool', () => {
    it('should successfully create a task with valid inputs and log activity', async () => {
      const res = await toolRegistry.executeTool('createTask', getContextOrg1('MEMBER'), {
        projectId: project1Id,
        title: 'Refactor Redis cache eviction policy',
        description: 'Implement LRU eviction on Redis cache keys.',
        priority: 'HIGH',
        status: 'TODO',
        assigneeId: rahulUserId,
      });

      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      const created = res.data as { id: string; title: string; priority: string; assignee?: { id: string } };
      expect(created.title).toBe('Refactor Redis cache eviction policy');
      expect(created.priority).toBe('HIGH');
      expect(created.assignee?.id).toBe(rahulUserId);

      // Verify activity log created
      const activity = await prisma.activityLog.findFirst({
        where: {
          organizationId: org1Id,
          entityType: EntityType.TASK,
          entityId: created.id,
          action: ActivityAction.CREATED,
        },
      });
      expect(activity).toBeDefined();
      expect(activity?.userId).toBe(user1Id);
    });

    it('should reject task creation if caller has VIEWER role', async () => {
      const res = await toolRegistry.executeTool('createTask', getContextOrg1('VIEWER', viewerUserId), {
        projectId: project1Id,
        title: 'Unauthorized Task Creation Attempt',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('not authorized to execute tool "createTask"');
    });

    it('should reject task creation across tenants (Org A user targeting Org B projectId)', async () => {
      const res = await toolRegistry.executeTool('createTask', getContextOrg1('OWNER'), {
        projectId: project2Id, // Org B's project
        title: 'Cross Tenant Task Attempt',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Project not found in this organization');
    });

    it('should reject task creation with missing required fields or invalid UUID', async () => {
      const res = await toolRegistry.executeTool('createTask', getContextOrg1('OWNER'), {
        projectId: 'not-a-uuid',
        title: '',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Tool argument validation failed');
    });

    it('should reject assignee if assignee is not a member of the organization', async () => {
      const res = await toolRegistry.executeTool('createTask', getContextOrg1('OWNER'), {
        projectId: project1Id,
        title: 'Invalid Assignee Task',
        assigneeId: user2Id, // User 2 is NOT in Org 1
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('not members of the organization');
    });
  });

  describe('updateTask Tool', () => {
    it('should successfully update task status, priority, and title', async () => {
      const res = await toolRegistry.executeTool('updateTask', getContextOrg1('MEMBER'), {
        taskId: task1Id,
        title: 'Updated Alpha Task Title',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
      });

      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);

      const updated = res.data as { id: string; title: string; status: string; priority: string };
      expect(updated.id).toBe(task1Id);
      expect(updated.title).toBe('Updated Alpha Task Title');
      expect(updated.status).toBe('IN_PROGRESS');
      expect(updated.priority).toBe('URGENT');
    });

    it('should reject update if caller has VIEWER role', async () => {
      const res = await toolRegistry.executeTool('updateTask', getContextOrg1('VIEWER', viewerUserId), {
        taskId: task1Id,
        status: 'DONE',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('not authorized to execute tool "updateTask"');
    });

    it('should reject cross-tenant task update (Org A user targeting Org B taskId)', async () => {
      const res = await toolRegistry.executeTool('updateTask', getContextOrg1('OWNER'), {
        taskId: task2Id, // Org B's task
        title: 'Malicious Cross Tenant Update',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Task not found in this organization');
    });

    it('should reject update with no modified fields', async () => {
      const res = await toolRegistry.executeTool('updateTask', getContextOrg1('OWNER'), {
        taskId: task1Id,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Tool argument validation failed');
    });
  });

  describe('assignTask Tool', () => {
    it('should successfully assign task to organization member and log activity', async () => {
      const res = await toolRegistry.executeTool('assignTask', getContextOrg1('MEMBER'), {
        taskId: task1Id,
        assigneeId: rahulUserId,
      });

      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);

      const assigned = res.data as { id: string; assignee?: { id: string } };
      expect(assigned.assignee?.id).toBe(rahulUserId);

      // Verify activity log
      const activity = await prisma.activityLog.findFirst({
        where: {
          organizationId: org1Id,
          entityType: EntityType.TASK,
          entityId: task1Id,
          action: ActivityAction.TASK_ASSIGNED,
        },
      });
      expect(activity).toBeDefined();
    });

    it('should reject task assignment if caller has VIEWER role', async () => {
      const res = await toolRegistry.executeTool('assignTask', getContextOrg1('VIEWER', viewerUserId), {
        taskId: task1Id,
        assigneeId: rahulUserId,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('not authorized to execute tool "assignTask"');
    });

    it('should reject cross-tenant task assignment (Org A user targeting Org B taskId)', async () => {
      const res = await toolRegistry.executeTool('assignTask', getContextOrg1('OWNER'), {
        taskId: task2Id,
        assigneeId: rahulUserId,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Task not found in this organization');
    });
  });

  describe('Agent Integration: End-to-End Task Mutation Workflow', () => {
    it('Scenario: "Create a high-priority task called Fix payment bug and assign it to Rahul"', async () => {
      const customMock = new MockAiLlmProvider();
      let step = 0;

      customMock.setHandler(async (messages) => {
        step++;
        const toolMsgs = messages.filter((m) => m.role === 'tool');

        if (step === 1) {
          // Step 1: LLM searches for Rahul in members
          return {
            content: 'Searching for Rahul in organization members.',
            toolCalls: [{ id: 'call-1', name: 'searchMembers', arguments: { search: 'Rahul' } }],
            finishReason: 'tool_calls',
          };
        }

        if (step === 2) {
          // Step 2: LLM searches for available projects
          const memberMsg = toolMsgs.find((m) => m.name === 'searchMembers');
          expect(memberMsg).toBeDefined();

          return {
            content: 'Found Rahul. Now searching for project.',
            toolCalls: [{ id: 'call-2', name: 'searchProjects', arguments: { search: 'Core' } }],
            finishReason: 'tool_calls',
          };
        }

        if (step === 3) {
          // Step 3: LLM calls createTask with discovered project & member IDs
          const projectMsg = toolMsgs.find((m) => m.name === 'searchProjects');
          expect(projectMsg).toBeDefined();

          return {
            content: 'Found project. Creating task now.',
            toolCalls: [
              {
                id: 'call-3',
                name: 'createTask',
                arguments: {
                  projectId: project1Id,
                  title: 'Fix payment bug',
                  description: 'Payment gateway timeout during checkout webhook.',
                  priority: 'HIGH',
                  assigneeId: rahulUserId,
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        // Step 4: Task created successfully, formulate final natural-language confirmation
        const createMsg = toolMsgs.find((m) => m.name === 'createTask');
        expect(createMsg).toBeDefined();
        const parsed = JSON.parse(createMsg?.content ?? '{}');
        expect(parsed.success).toBe(true);

        return {
          content: `Task "Fix payment bug" was successfully created with HIGH priority in the Core Platform Engine project and assigned to Rahul Sharma.`,
          finishReason: 'stop',
        };
      });

      const orchestrator = new AgentOrchestrator(customMock, toolRegistry, ragService);

      const response = await orchestrator.run(getContextOrg1('OWNER'), {
        message: 'Create a high-priority task called Fix payment bug and assign it to Rahul',
        includeRagContext: false,
      });

      expect(response.stepsCount).toBe(4);
      expect(response.toolCallsCount).toBe(3);
      expect(response.toolsUsed).toContain('searchMembers');
      expect(response.toolsUsed).toContain('searchProjects');
      expect(response.toolsUsed).toContain('createTask');
      expect(response.answer).toContain('Fix payment bug');
      expect(response.answer).toContain('Rahul Sharma');

      // Verify task in DB
      const dbTask = await prisma.task.findFirst({
        where: {
          title: 'Fix payment bug',
          projectId: project1Id,
        },
      });
      expect(dbTask).toBeDefined();
      expect(dbTask?.priority).toBe('HIGH');
      expect(dbTask?.assigneeId).toBe(rahulUserId);
    });

    it('should NOT report false success if mutation tool fails', async () => {
      const failureMock = new MockAiLlmProvider();
      let step = 0;

      failureMock.setHandler(async (messages) => {
        step++;
        if (step === 1) {
          return {
            content: 'Attempting to create task with invalid project ID.',
            toolCalls: [
              {
                id: 'call-fail-1',
                name: 'createTask',
                arguments: {
                  projectId: '00000000-0000-0000-0000-000000000000',
                  title: 'Doomed Task',
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        const toolMsg = messages.find((m) => m.role === 'tool');
        const parsed = JSON.parse(toolMsg?.content ?? '{}');
        expect(parsed.success).toBe(false);

        return {
          content: 'I could not create the task because the project was not found in your organization.',
          finishReason: 'stop',
        };
      });

      const orchestrator = new AgentOrchestrator(failureMock, toolRegistry, ragService);

      const response = await orchestrator.run(getContextOrg1('OWNER'), {
        message: 'Create doomed task',
        includeRagContext: false,
      });

      expect(response.answer).toContain('could not create the task');
      expect(response.answer).not.toContain('Task created successfully');
    });
  });
});
