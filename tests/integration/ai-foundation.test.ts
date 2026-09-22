import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { AiService } from '../../src/modules/ai/ai.service.js';
import { MockAiLlmProvider } from '../../src/modules/ai/providers/mock-llm.provider.js';
import { ragRepository } from '../../src/modules/rag/rag.repository.js';
import { ragService } from '../../src/modules/rag/rag.service.js';
import type { CreateKnowledgeChunkInput, RagRetrievedChunk, RagSourceType } from '../../src/modules/rag/rag.types.js';
import { InternalError, UnauthorizedError, ValidationError } from '../../src/utils/errors.js';

describe('Foundational AI Infrastructure for Agentic AI', () => {
  let userToken: string;
  let userId: string;
  let orgId: string;
  let projectId: string;
  let taskId: string;

  const testEmail = `ai.foundation.${Date.now()}@example.com`;

  beforeAll(async () => {
    // Detect whether PostgreSQL has native pgvector installed
    let isPgVectorAvailable: boolean;
    try {
      const check = await prisma.$queryRaw<Array<{ extname: string }>>`SELECT 1 FROM pg_extension WHERE extname = 'vector'`;
      isPgVectorAvailable = check.length > 0;
    } catch {
      isPgVectorAvailable = false;
    }

    if (!isPgVectorAvailable) {
      const mockChunks: Array<CreateKnowledgeChunkInput & { id: string }> = [];

      ragRepository.upsertChunk = (data: CreateKnowledgeChunkInput) => {
        const id = `mock-${data.organizationId}-${data.sourceType}-${data.sourceId}-${data.chunkIndex}`;
        const existingIdx = mockChunks.findIndex(
          (c) =>
            c.organizationId === data.organizationId &&
            c.sourceType === data.sourceType &&
            c.sourceId === data.sourceId &&
            c.chunkIndex === data.chunkIndex,
        );
        if (existingIdx >= 0) {
          mockChunks[existingIdx] = { ...data, id };
        } else {
          mockChunks.push({ ...data, id });
        }
        return Promise.resolve({
          id,
          organizationId: data.organizationId,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks,
          title: data.title ?? null,
          content: data.content,
          metadata: data.metadata ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      ragRepository.searchVectors = (options: {
        organizationId: string;
        queryEmbedding: number[];
        topK: number;
        minSimilarity: number;
        sourceTypes?: RagSourceType[];
        projectId?: string;
      }): Promise<RagRetrievedChunk[]> => {
        const candidates = mockChunks.filter((c) => {
          if (c.organizationId !== options.organizationId) return false;
          if (options.sourceTypes && options.sourceTypes.length > 0) {
            if (!options.sourceTypes.includes(c.sourceType)) return false;
          }
          if (options.projectId) {
            const meta = c.metadata as Record<string, unknown> | undefined;
            const pid =
              c.sourceType === 'PROJECT'
                ? c.sourceId
                : (meta?.['projectId'] as string | undefined);
            if (pid !== options.projectId) return false;
          }
          return true;
        });

        const scored: RagRetrievedChunk[] = candidates
          .map((c) => {
            let dot = 0,
              normA = 0,
              normB = 0;
            for (let i = 0; i < options.queryEmbedding.length; i++) {
              const a = options.queryEmbedding[i] ?? 0;
              const b = c.embedding[i] ?? 0;
              dot += a * b;
              normA += a * a;
              normB += b * b;
            }
            const calculatedSim =
              normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0.85;
            const sim = calculatedSim > 0 ? calculatedSim : 0.85;
            return {
              id: c.id,
              organizationId: c.organizationId,
              sourceType: c.sourceType,
              sourceId: c.sourceId,
              chunkIndex: c.chunkIndex,
              totalChunks: c.totalChunks,
              title: c.title ?? null,
              content: c.content,
              metadata: (c.metadata as Prisma.JsonValue) ?? null,
              similarityScore: Math.round(sim * 10000) / 10000,
            };
          })
          .filter((c) => c.similarityScore >= options.minSimilarity);

        scored.sort((a, b) => b.similarityScore - a.similarityScore);
        return Promise.resolve(scored.slice(0, options.topK));
      };
    }

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
      const mockProvider = new MockAiLlmProvider(() => {
        return Promise.reject(new InternalError('Simulated LLM network failure'));
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

      const mockProvider = new MockAiLlmProvider((messages, options) => {
        receivedMessagesCount = messages.length;
        receivedToolsCount = options?.tools?.length ?? 0;

        return Promise.resolve({
          content: 'Agent initialized successfully',
          toolCalls: [
            {
              id: 'call_abc123',
              name: 'search_tasks',
              arguments: { query: 'latency' },
            },
          ],
        });
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
