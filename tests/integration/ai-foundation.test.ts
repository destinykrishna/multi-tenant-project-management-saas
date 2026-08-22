import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { AiService } from '../../src/modules/ai/ai.service.js';
import { MockAiLlmProvider } from '../../src/modules/ai/providers/mock-llm.provider.js';
import { ragService } from '../../src/modules/rag/rag.service.js';
import { InternalError, UnauthorizedError, ValidationError } from '../../src/utils/errors.js';

describe('Foundational AI Infrastructure for Agentic AI', () => {
  let userToken: string;
  let userId: string;
  let orgId: string;
  let projectId: string;
  let taskId: string;

  const testEmail = `ai.foundation.${Date.now()}@example.com`;

  beforeAll(async () => {
    // 1. Create User + Org
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'AI Foundation User',
        email: testEmail,
        password: 'Password123!',
        organizationName: 'AI Core Corp',
      })
      .expect(201);

    userToken = res.body.data.accessToken;
    userId = res.body.data.user.id;
    orgId = res.body.data.organization.id;

    // 2. Create Project and Task for RAG bridging
    const projRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'Autonomous Core System',
        key: 'ACS',
        description: 'Next generation intelligence framework',
      })
      .expect(201);
    projectId = projRes.body.data.id;

    const taskRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'Calibrate LLM provider latency',
        description: 'Optimize token throughput and context window management.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
      })
      .expect(201);
    taskId = taskRes.body.data.id;

    // Index task into RAG
    await ragService.indexTask(orgId, taskId);
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (user) {
      await prisma.$transaction([
        prisma.ragKnowledgeDocument.deleteMany({ where: { organization: { ownerId: user.id } } }),
        prisma.meeting.deleteMany({ where: { organization: { ownerId: user.id } } }),
        prisma.comment.deleteMany({ where: { user: { id: user.id } } }),
        prisma.task.deleteMany({ where: { project: { organization: { ownerId: user.id } } } }),
        prisma.project.deleteMany({ where: { organization: { ownerId: user.id } } }),
        prisma.activityLog.deleteMany({ where: { userId: user.id } }),
        prisma.refreshSession.deleteMany({ where: { userId: user.id } }),
        prisma.organizationMember.deleteMany({ where: { userId: user.id } }),
        prisma.organization.deleteMany({ where: { ownerId: user.id } }),
        prisma.user.delete({ where: { id: user.id } }),
      ]);
    }
    await disconnectDatabase();
  });

  describe('Execution Limits Configuration', () => {
    it('should expose valid agent execution limits from environment', () => {
      const aiService = new AiService();
      const limits = aiService.getExecutionLimits();

      expect(limits.maxSteps).toBe(env.AI_MAX_STEPS);
      expect(limits.maxToolCalls).toBe(env.AI_MAX_TOOL_CALLS);
      expect(limits.timeoutMs).toBe(env.AI_REQUEST_TIMEOUT_MS);
      expect(limits.maxOutputTokens).toBe(env.AI_MAX_OUTPUT_TOKENS);
      expect(limits.maxContextTokens).toBeGreaterThan(0);
    });
  });

  describe('Tenant Context Propagation & Input Validation', () => {
    it('should reject generation when organizationId or userId is missing', async () => {
      const aiService = new AiService();

      await expect(
        aiService.generate(
          { organizationId: '', userId: '', userRole: 'MEMBER' },
          { prompt: 'Hello AI' },
        ),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should reject generation when prompt is empty or whitespace', async () => {
      const aiService = new AiService();

      await expect(
        aiService.generate(
          { organizationId: orgId, userId, userRole: 'MEMBER' },
          { prompt: '   ' },
        ),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('LLM Provider Abstraction & Execution', () => {
    it('should successfully generate an AI response via provider abstraction', async () => {
      const mockProvider = new MockAiLlmProvider();
      const aiService = new AiService(mockProvider);

      const response = await aiService.generate(
        { organizationId: orgId, userId, userRole: 'MEMBER' },
        { prompt: 'Analyze database query latency' },
      );

      expect(response).toBeDefined();
      expect(response.content).toContain('Analyze database query latency');
      expect(response.usage?.totalTokens).toBe(75);
    });

    it('should handle LLM provider errors gracefully', async () => {
      const mockProvider = new MockAiLlmProvider(async () => {
        throw new InternalError('Simulated LLM network failure');
      });
      const aiService = new AiService(mockProvider);

      await expect(
        aiService.generate(
          { organizationId: orgId, userId, userRole: 'MEMBER' },
          { prompt: 'Generate report' },
        ),
      ).rejects.toThrow('Simulated LLM network failure');
    });

    it('should handle timeout simulation correctly', async () => {
      const mockProvider = new MockAiLlmProvider();
      const aiService = new AiService(mockProvider);

      // Verify that timeoutMs parameter is respected
      const response = await aiService.generate(
        { organizationId: orgId, userId, userRole: 'MEMBER' },
        { prompt: 'SIMULATE_TIMEOUT task evaluation', timeoutMs: 50 },
      );

      expect(response.content).toBeDefined();
    });
  });

  describe('RAG Context Bridge', () => {
    it('should bridge RAG context safely into AI prompt without credential leakage', async () => {
      const mockProvider = new MockAiLlmProvider();
      const aiService = new AiService(mockProvider, ragService);

      const response = await aiService.generate(
        { organizationId: orgId, userId, userRole: 'MEMBER' },
        {
          prompt: 'How do we calibrate LLM latency?',
          includeRagContext: true,
          ragQuery: 'calibrate LLM latency',
        },
      );

      expect(response.content).toContain('incorporating verified organization context');
      expect(response.sources).toBeInstanceOf(Array);
      expect(response.sources?.length).toBeGreaterThan(0);

      const firstSource = response.sources?.[0];
      expect(firstSource?.sourceType).toBe('TASK');
      expect(firstSource?.sourceId).toBe(taskId);
      expect(firstSource?.title).toBe('Task: Calibrate LLM provider latency');
    });
  });

  describe('Agent Blueprint & Tool Definition Support', () => {
    it('should support AgentDefinition and tool schemas without executing tools', async () => {
      let receivedMessagesCount = 0;
      let receivedToolsCount = 0;

      const mockProvider = new MockAiLlmProvider(async (messages, options) => {
        receivedMessagesCount = messages.length;
        receivedToolsCount = options?.tools?.length ?? 0;

        return {
          content: 'Agent initialized successfully',
          toolCalls: [
            {
              id: 'call_abc123',
              name: 'search_tasks',
              arguments: { query: 'latency' },
            },
          ],
        };
      });

      const aiService = new AiService(mockProvider);

      const agent = {
        name: 'TaskOptimizationAgent',
        description: 'Analyzes task backlog and suggests optimizations',
        systemInstructions: 'You specialize in task workflow optimizations.',
        availableTools: [
          {
            name: 'search_tasks',
            description: 'Search tasks within the organization',
            parameters: {
              type: 'object' as const,
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        ],
      };

      const response = await aiService.generate(
        { organizationId: orgId, userId, userRole: 'MEMBER', agent },
        { prompt: 'Optimize task backlog' },
      );

      expect(receivedMessagesCount).toBe(2); // system + user
      expect(receivedToolsCount).toBe(1);
      expect(response.content).toBe('Agent initialized successfully');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0]?.name).toBe('search_tasks');
    });
  });
});
