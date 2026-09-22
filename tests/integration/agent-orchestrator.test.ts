import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { hashPassword } from '../../src/utils/password.js';
import { AgentOrchestrator, agentOrchestrator } from '../../src/modules/ai/agent.orchestrator.js';
import { MockAiLlmProvider } from '../../src/modules/ai/providers/mock-llm.provider.js';
import { toolRegistry } from '../../src/modules/ai/tools/tool-registry.js';
import { ragService } from '../../src/modules/rag/rag.service.js';
import type { AiRequestContext } from '../../src/modules/ai/ai.types.js';

describe('Agent Orchestrator & Read-Only Tool-Calling Workflow', () => {
  let user1Token: string;
  let user1Id: string;
  let org1Id: string;

  let user2Token: string;
  let user2Id: string;
  let org2Id: string;

  let project1Id: string;
  let task1Id: string;
  let rahulUserId: string;

  const testEmail1 = `agent.test.org1.${Date.now()}@example.com`;
  const testEmail2 = `agent.test.org2.${Date.now()}@example.com`;
  const rahulEmail = `rahul.agent.${Date.now()}@example.com`;

  beforeAll(async () => {
    // 1. Create Org 1 Owner
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Agent Org A Owner',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Agent Intelligence Alpha',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;
    org1Id = res1.body.data.organization.id;

    // 2. Create Org 2 Owner
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Agent Org B Owner',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Agent Intelligence Beta',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;
    user2Id = res2.body.data.user.id;
    org2Id = res2.body.data.organization.id;

    // 3. Create Rahul user directly without an initial organization & add to Org 1
    const passwordHash = await hashPassword('Password123!');
    const rahulUser = await prisma.user.create({
      data: {
        name: 'Rahul Sharma',
        email: rahulEmail,
        passwordHash,
        isEmailVerified: true,
      },
    });

    rahulUserId = rahulUser.id;

    // Add Rahul as Member to Org 1
    await prisma.organizationMember.create({
      data: {
        organizationId: org1Id,
        userId: rahulUserId,
        role: 'MEMBER',
      },
    });

    // 4. Create Project 1 in Org 1
    const projRes = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Alpha Project Engine',
        key: 'APE',
        description: 'Alpha proprietary neural project engine',
      })
      .expect(201);
    project1Id = projRes.body.data.id;

    // 5. Create Task assigned to Rahul in Project 1
    const taskRes = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'Fix overdue database connection pool saturation',
        description: 'Resolve connection exhaustion under high load.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        assigneeId: rahulUserId,
      })
      .expect(201);
    task1Id = taskRes.body.data.id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [testEmail1, testEmail2, rahulEmail] } },
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

  const getContextOrg1 = (role = 'OWNER'): AiRequestContext => ({
    organizationId: org1Id,
    userId: user1Id,
    userRole: role,
  });

  describe('Agent Orchestration Core Workflows', () => {
    it('1. Direct Answer: should answer directly without invoking tools when no tool is required', async () => {
      const response = await agentOrchestrator.run(getContextOrg1(), {
        message: 'Hello, what are your general capabilities as an AI assistant?',
        includeRagContext: false,
      });

      expect(response.answer).toBeDefined();
      expect(response.stepsCount).toBe(1);
      expect(response.toolCallsCount).toBe(0);
      expect(response.toolsUsed).toHaveLength(0);
    });

    it('2. Single Tool Call: should execute searchProjects and synthesize result', async () => {
      const response = await agentOrchestrator.run(getContextOrg1(), {
        message: 'Search projects for Alpha',
        includeRagContext: false,
      });

      expect(response.answer).toBeDefined();
      expect(response.toolCallsCount).toBeGreaterThanOrEqual(1);
      expect(response.toolsUsed).toContain('searchProjects');
      expect(response.answer).toContain('Alpha');
    });

    it('3. Multi-Step Workflow: should search member and their overdue tasks', async () => {
      const customMock = new MockAiLlmProvider();
      let stepCounter = 0;

      customMock.setHandler(async (messages) => {
        stepCounter++;
        const toolMsgs = messages.filter((m) => m.role === 'tool');

        if (stepCounter === 1) {
          // Step 1: LLM decides to search for member "Rahul"
          return {
            content: 'Searching for Rahul Sharma in the organization.',
            toolCalls: [{ id: 'call-1', name: 'searchMembers', arguments: { search: 'Rahul' } }],
            finishReason: 'tool_calls',
          };
        }

        if (stepCounter === 2) {
          // Step 2: Member found; LLM decides to search Rahul's tasks
          const memberResult = toolMsgs.find((m) => m.name === 'searchMembers');
          expect(memberResult).toBeDefined();

          return {
            content: 'Found member. Now retrieving their tasks.',
            toolCalls: [
              {
                id: 'call-2',
                name: 'searchTasks',
                arguments: { projectId: project1Id, assigneeId: rahulUserId },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        // Step 3: Tasks found; synthesize final response
        return {
          content: 'Rahul Sharma has 1 high-priority task assigned: "Fix overdue database connection pool saturation" in the Alpha Project Engine.',
          finishReason: 'stop',
        };
      });

      const orchestrator = new AgentOrchestrator(customMock, toolRegistry, ragService);

      const response = await orchestrator.run(getContextOrg1(), {
        message: 'Find Rahul and tell me which of his tasks are overdue.',
        includeRagContext: false,
      });

      expect(response.stepsCount).toBe(3);
      expect(response.toolCallsCount).toBe(2);
      expect(response.toolsUsed).toContain('searchMembers');
      expect(response.toolsUsed).toContain('searchTasks');
      expect(response.answer).toContain('Rahul Sharma');
      expect(response.answer).toContain('Fix overdue database connection pool saturation');
    });
  });

  describe('Guardrails, Safety Limits & Error Recovery', () => {
    it('should detect duplicate tool call loops and prevent infinite execution', async () => {
      const loopMock = new MockAiLlmProvider();

      // Mock LLM that endlessly repeats the same tool call
      loopMock.setHandler(async () => ({
        content: 'Let me check projects again.',
        toolCalls: [{ id: `call-${Date.now()}`, name: 'searchProjects', arguments: { search: 'Alpha' } }],
        finishReason: 'tool_calls',
      }));

      const orchestrator = new AgentOrchestrator(loopMock, toolRegistry, ragService);

      const response = await orchestrator.run(getContextOrg1(), {
        message: 'Keep checking projects forever',
        includeRagContext: false,
        maxSteps: 5,
      });

      expect(response.stepsCount).toBeLessThanOrEqual(5);
      expect(response.answer).toBeDefined();
    });

    it('should enforce max tool call limit and synthesize response with gathered data', async () => {
      const floodMock = new MockAiLlmProvider();

      floodMock.setHandler(async (messages) => {
        const hasFinalPrompt = messages.some((m) => m.content.includes('Maximum tool execution limit reached'));
        if (hasFinalPrompt) {
          return {
            content: 'Summary after reaching limit: Gathered initial project data.',
            finishReason: 'stop',
          };
        }

        return {
          content: 'Calling multiple tools at once.',
          toolCalls: [
            { id: 'call-1', name: 'searchProjects', arguments: { search: 'A' } },
            { id: 'call-2', name: 'searchProjects', arguments: { search: 'B' } },
            { id: 'call-3', name: 'searchProjects', arguments: { search: 'C' } },
          ],
          finishReason: 'tool_calls',
        };
      });

      const orchestrator = new AgentOrchestrator(floodMock, toolRegistry, ragService);

      const response = await orchestrator.run(getContextOrg1(), {
        message: 'Execute lots of tools',
        includeRagContext: false,
        maxToolCalls: 2, // Hard limit of 2
      });

      expect(response.toolCallsCount).toBeLessThanOrEqual(2);
      expect(response.answer).toContain('Summary after reaching limit');
    });

    it('should safely handle tool errors without exposing database internals', async () => {
      const errorMock = new MockAiLlmProvider();
      let step = 0;

      errorMock.setHandler(async (messages) => {
        step++;
        if (step === 1) {
          return {
            content: 'Querying invalid project ID.',
            toolCalls: [
              {
                id: 'call-err-1',
                name: 'getProject',
                arguments: { projectId: '00000000-0000-0000-0000-000000000000' },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        const toolMsg = messages.find((m) => m.role === 'tool');
        expect(toolMsg).toBeDefined();
        const parsed = JSON.parse(toolMsg?.content ?? '{}');
        expect(parsed.success).toBe(false);

        return {
          content: 'The requested project could not be found in your organization.',
          finishReason: 'stop',
        };
      });

      const orchestrator = new AgentOrchestrator(errorMock, toolRegistry, ragService);

      const response = await orchestrator.run(getContextOrg1(), {
        message: 'Find nonexistent project',
        includeRagContext: false,
      });

      expect(response.answer).toContain('could not be found');
    });

    it('should reject unauthenticated and empty message requests with validation error', async () => {
      await expect(
        agentOrchestrator.run({ organizationId: '', userId: '', userRole: 'MEMBER' }, { message: 'Hello' }),
      ).rejects.toThrow('Authentication and organization context are required');

      await expect(
        agentOrchestrator.run(getContextOrg1(), { message: '   ' }),
      ).rejects.toThrow('Message cannot be empty');
    });
  });

  describe('HTTP API Endpoint: POST /api/v1/organizations/:organizationId/ai/agent', () => {
    it('should reject unauthenticated request with 401', async () => {
      await request(app)
        .post(`/api/v1/organizations/${org1Id}/ai/agent`)
        .send({ message: 'List my projects' })
        .expect(401);
    });

    it('should reject cross-tenant unauthorized user with 403', async () => {
      // User 2 (Org B) attempting to run agent on Org 1
      await request(app)
        .post(`/api/v1/organizations/${org1Id}/ai/agent`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ message: 'List my projects' })
        .expect(403);
    });

    it('should reject invalid request body with 422', async () => {
      await request(app)
        .post(`/api/v1/organizations/${org1Id}/ai/agent`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ message: '' })
        .expect(422);
    });

    it('should execute agent successfully and return 200 with structured answer', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/ai/agent`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          message: 'What projects are currently active in our organization?',
          includeRagContext: false,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toBeDefined();
      expect(typeof res.body.data.stepsCount).toBe('number');
      expect(typeof res.body.data.toolCallsCount).toBe('number');
      expect(Array.isArray(res.body.data.toolsUsed)).toBe(true);
    });
  });
});
