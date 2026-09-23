import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { ragRepository } from '../../src/modules/rag/rag.repository.js';
import { ragService } from '../../src/modules/rag/rag.service.js';
import type { CreateKnowledgeChunkInput, RagSourceType } from '../../src/modules/rag/rag.types.js';
import { chunkText } from '../../src/modules/rag/utils/chunker.js';
import { processRagJob } from '../../src/jobs/workers/rag.worker.js';
import type { Job } from 'bullmq';
import type { RagJobData } from '../../src/jobs/queues/rag.queue.js';

describe('RAG Foundation & Entity Ingestion/Indexing Pipeline', () => {
  let user1Token: string;
  let org1Id: string;

  let user2Token: string;

  let projectId: string;
  let taskId: string;
  let commentId: string;
  let activityId: string;

  const testEmail1 = `rag.test.user1.${Date.now()}@example.com`;
  const testEmail2 = `rag.test.user2.${Date.now()}@example.com`;

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
      ragRepository.upsertChunk = async (data: CreateKnowledgeChunkInput) => {
        const metadataJson = JSON.stringify(data.metadata ?? {});
        const rows = await prisma.$queryRawUnsafe<
          Array<{
            id: string;
            organizationId: string;
            sourceType: RagSourceType;
            sourceId: string;
            chunkIndex: number;
            totalChunks: number;
            title: string | null;
            content: string;
            metadata: unknown;
            createdAt: Date;
            updatedAt: Date;
          }>
        >(
          `
          INSERT INTO "rag_knowledge_documents" (
            "id", "organizationId", "sourceType", "sourceId", "chunkIndex", "totalChunks",
            "title", "content", "metadata", "embedding", "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid(), $1, $2::"RagSourceType", $3, $4, $5, $6, $7, $8::jsonb, $9::float8[], NOW(), NOW()
          )
          ON CONFLICT ("organizationId", "sourceType", "sourceId", "chunkIndex")
          DO UPDATE SET
            "totalChunks" = EXCLUDED."totalChunks",
            "title" = EXCLUDED."title",
            "content" = EXCLUDED."content",
            "metadata" = EXCLUDED."metadata",
            "embedding" = EXCLUDED."embedding",
            "updatedAt" = NOW()
          RETURNING
            "id", "organizationId", "sourceType", "sourceId", "chunkIndex", "totalChunks",
            "title", "content", "metadata", "createdAt", "updatedAt";
        `,
          data.organizationId,
          data.sourceType,
          data.sourceId,
          data.chunkIndex,
          data.totalChunks,
          data.title ?? null,
          data.content,
          metadataJson,
          data.embedding,
        );
        const row = rows[0];
        if (!row) {
          throw new Error('Failed to upsert knowledge chunk');
        }
        return row;
      };
    }

    // 1. Register User 1 + Org 1
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'RAG Owner 1',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'RAG Ingestion Corp',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    org1Id = res1.body.data.organization.id;

    // 2. Register User 2 + Org 2
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'RAG Owner 2',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Other Tenant Inc',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;

    // 3. Create Sample Project in Org 1
    const projectRes = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Neural Engine Core',
        key: 'NEC',
        description: 'Deep Learning pipeline for real-time natural language reasoning and parsing',
      })
      .expect(201);
    projectId = projectRes.body.data.id;

    // 4. Create Sample Task in Org 1
    const taskRes = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'Optimize Vector Indexing',
        description: 'Improve dense embeddings storage and caching mechanism for high-throughput queries',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
      })
      .expect(201);
    taskId = taskRes.body.data.id;

    // 5. Create Sample Comment in Org 1
    const commentRes = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${projectId}/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        content: 'Benchmarks indicate 1536-dimensional vectors with L2 normalization yield 98% cosine recall.',
      })
      .expect(201);
    commentId = commentRes.body.data.id;

    // 6. Fetch created Activity Log in Org 1
    const activityLog = await prisma.activityLog.findFirst({
      where: { organizationId: org1Id },
    });
    activityId = activityLog?.id ?? '';
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
  });

  describe('Chunking Utility', () => {
    it('should return a single chunk for content within maxChunkSize', () => {
      const text = 'Short document content';
      const chunks = chunkText(text, { maxChunkSize: 500 });
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('Short document content');
    });

    it('should split long content into multiple chunks with overlap', () => {
      const longText = 'Sentence one. '.repeat(100);
      const chunks = chunkText(longText, { maxChunkSize: 200, overlap: 30 });
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(250);
      }
    });

    it('should handle empty or whitespace text gracefully', () => {
      expect(chunkText('')).toEqual([]);
      expect(chunkText('   ')).toEqual([]);
    });
  });

  describe('Targeted Entity Indexing via RAG Service', () => {
    it('should index a Project into RagKnowledgeDocument', async () => {
      const result = await ragService.indexProject(org1Id, projectId);
      expect(result.success).toBe(true);
      expect(result.sourceType).toBe('PROJECT');
      expect(result.sourceId).toBe(projectId);
      expect(result.chunksCreated).toBeGreaterThanOrEqual(1);

      const docs = await prisma.ragKnowledgeDocument.findMany({
        where: { organizationId: org1Id, sourceType: 'PROJECT', sourceId: projectId },
      });
      expect(docs).toHaveLength(1);
      const firstDoc = docs[0];
      expect(firstDoc).toBeDefined();
      if (!firstDoc) {
        throw new Error('Expected firstDoc to be defined');
      }
      expect(firstDoc.title).toContain('Neural Engine Core');
      expect(firstDoc.content).toContain('Project: Neural Engine Core (NEC)');
      const [rawRow] = await prisma.$queryRawUnsafe<Array<{ embedding: number[] | null }>>(
        `SELECT embedding FROM "rag_knowledge_documents" WHERE "id" = $1`,
        firstDoc.id,
      );
      expect(rawRow?.embedding).toBeDefined();
      if (Array.isArray(rawRow?.embedding)) {
        expect(rawRow.embedding.length).toBe(env.EMBEDDING_DIMENSION);
      }
    });

    it('should index a Task with metadata and details', async () => {
      const result = await ragService.indexTask(org1Id, taskId);
      expect(result.success).toBe(true);
      expect(result.sourceType).toBe('TASK');
      expect(result.sourceId).toBe(taskId);

      const doc = await prisma.ragKnowledgeDocument.findFirst({
        where: { organizationId: org1Id, sourceType: 'TASK', sourceId: taskId },
      });
      expect(doc).toBeDefined();
      expect(doc?.title).toBe('Task: Optimize Vector Indexing');
      expect(doc?.content).toContain('Status: IN_PROGRESS');
      expect(doc?.content).toContain('Priority: HIGH');
    });

    it('should index a Comment linked to task and author', async () => {
      const result = await ragService.indexComment(org1Id, commentId);
      expect(result.success).toBe(true);
      expect(result.sourceType).toBe('COMMENT');
      expect(result.sourceId).toBe(commentId);

      const doc = await prisma.ragKnowledgeDocument.findFirst({
        where: { organizationId: org1Id, sourceType: 'COMMENT', sourceId: commentId },
      });
      expect(doc).toBeDefined();
      expect(doc?.content).toContain('1536-dimensional vectors');
    });

    it('should index an Activity Log with action details', async () => {
      if (!activityId) return;

      const result = await ragService.indexActivityLog(org1Id, activityId);
      expect(result.success).toBe(true);
      expect(result.sourceType).toBe('ACTIVITY_LOG');

      const doc = await prisma.ragKnowledgeDocument.findFirst({
        where: { organizationId: org1Id, sourceType: 'ACTIVITY_LOG', sourceId: activityId },
      });
      expect(doc).toBeDefined();
      expect(doc?.title).toContain('Activity:');
    });
  });

  describe('Deterministic Upsert & Duplicate Prevention', () => {
    it('should update existing knowledge in place without creating duplicate records on re-indexing', async () => {
      // Re-index the task 3 times
      await ragService.indexTask(org1Id, taskId);
      await ragService.indexTask(org1Id, taskId);
      await ragService.indexTask(org1Id, taskId);

      const taskDocs = await prisma.ragKnowledgeDocument.findMany({
        where: { organizationId: org1Id, sourceType: 'TASK', sourceId: taskId },
      });

      // Must remain exactly 1 record (or same chunk count) - no duplicates
      expect(taskDocs).toHaveLength(1);
    });

    it('should safely delete knowledge when an entity is deleted', async () => {
      await ragService.deleteEntityKnowledge(org1Id, 'COMMENT', commentId);

      const count = await prisma.ragKnowledgeDocument.count({
        where: { organizationId: org1Id, sourceType: 'COMMENT', sourceId: commentId },
      });
      expect(count).toBe(0);
    });
  });

  describe('Security & Sensitive Data Exclusion', () => {
    it('should ensure passwords, hashes, and tokens are never included in knowledge content', async () => {
      const allDocs = await prisma.ragKnowledgeDocument.findMany({
        where: { organizationId: org1Id },
      });

      for (const doc of allDocs) {
        expect(doc.content).not.toContain('Password123!');
        expect(doc.content).not.toContain('passwordHash');
        expect(doc.content).not.toContain('refreshToken');
        expect(doc.content).not.toContain('ya29.');
      }
    });
  });

  describe('Organization Batch Indexing & HTTP Endpoints', () => {
    it('should trigger batch RAG indexing for entire organization via POST /rag/index?sync=true', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/index?sync=true`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.organizationId).toBe(org1Id);
      expect(response.body.data.projectsIndexed).toBeGreaterThanOrEqual(1);
      expect(response.body.data.tasksIndexed).toBeGreaterThanOrEqual(1);
      expect(response.body.data.totalChunks).toBeGreaterThan(0);
    });

    it('should enqueue batch RAG indexing asynchronously (202 Accepted) when sync is not specified', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/index`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.queued).toBe(true);
      expect(response.body.data.organizationId).toBe(org1Id);
      expect(response.body.data.jobId).toBeDefined();
    });

    it('should enqueue entity RAG indexing asynchronously (202 Accepted) when sync is not specified', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/index/entity`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          sourceType: 'PROJECT',
          sourceId: projectId,
        })
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.queued).toBe(true);
      expect(response.body.data.organizationId).toBe(org1Id);
      expect(response.body.data.sourceType).toBe('PROJECT');
      expect(response.body.data.sourceId).toBe(projectId);
      expect(response.body.data.jobId).toBeDefined();
    });

    it('should trigger entity RAG indexing synchronously (200 OK) when ?sync=true is specified', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/index/entity?sync=true`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          sourceType: 'PROJECT',
          sourceId: projectId,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sourceType).toBe('PROJECT');
      expect(response.body.data.sourceId).toBe(projectId);
      expect(response.body.data.success).toBe(true);
    });

    it('should successfully execute batch indexing in the BullMQ worker job processor', async () => {
      const mockJob = {
        id: 'mock-rag-batch-job-1',
        data: {
          type: 'index-organization-batch',
          organizationId: org1Id,
        },
      } as Job<RagJobData>;

      await expect(processRagJob(mockJob)).resolves.not.toThrow();
    });

    it('should successfully execute entity indexing in the BullMQ worker job processor', async () => {
      const mockJob = {
        id: 'mock-rag-entity-job-1',
        data: {
          type: 'index-entity',
          organizationId: org1Id,
          sourceType: 'PROJECT',
          sourceId: projectId,
        },
      } as Job<RagJobData>;

      await expect(processRagJob(mockJob)).resolves.not.toThrow();
    });

    it('should retrieve indexed documents without exposing raw embedding arrays in API responses', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${org1Id}/rag/documents`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThan(0);

      for (const doc of response.body.data.items) {
        expect(doc.embedding).toBeUndefined();
        expect(doc.organizationId).toBe(org1Id);
        expect(doc.title).toBeDefined();
        expect(doc.content).toBeDefined();
      }
    });

    it('should get organization RAG statistics via GET /rag/stats', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${org1Id}/rag/stats`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalDocuments).toBeGreaterThan(0);
      expect(response.body.data.bySourceType.PROJECT).toBeDefined();
    });

    it('should enforce strict tenant isolation (User 2 cannot view or index Org 1 knowledge)', async () => {
      const getRes = await request(app)
        .get(`/api/v1/organizations/${org1Id}/rag/documents`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);

      expect(getRes.body.success).toBe(false);
      expect(getRes.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');

      const indexRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/index`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);

      expect(indexRes.body.success).toBe(false);
      expect(indexRes.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });
  });
});
