import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { ragService } from '../../src/modules/rag/rag.service.js';

describe('RAG Semantic Retrieval Layer', () => {
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
  let comment1Id: string;

  const testEmail1 = `rag.retrieve.user1.${Date.now()}@example.com`;
  const testEmail2 = `rag.retrieve.user2.${Date.now()}@example.com`;

  beforeAll(async () => {
    // 1. Register User 1 + Org 1
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'RAG Search User 1',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Alpha RAG Corp',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;
    org1Id = res1.body.data.organization.id;

    // 2. Register User 2 + Org 2
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'RAG Search User 2',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Beta RAG Corp',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;
    user2Id = res2.body.data.user.id;
    org2Id = res2.body.data.organization.id;

    // 3. Create Sample Project 1 in Org 1
    const projRes1 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Neural Engine Core',
        key: 'NEC',
        description: 'Core machine learning infrastructure and tensor optimization algorithms',
      })
      .expect(201);
    project1Id = projRes1.body.data.id;

    // 4. Create Sample Project 2 in Org 1
    const projRes2 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        name: 'Billing Platform',
        key: 'BILL',
        description: 'Stripe webhook processor and invoice aggregation system',
      })
      .expect(201);
    project2Id = projRes2.body.data.id;

    // 5. Create Overdue Task in Project 1 (Org 1)
    const taskRes1 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'Fix overdue database connection pool saturation',
        description: 'Urgent: The primary PostgreSQL cluster connection pool is exhausted and queries are overdue.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        dueDate: new Date(Date.now() - 86400000).toISOString(),
      })
      .expect(201);
    task1Id = taskRes1.body.data.id;

    // 6. Create Normal Task in Project 2 (Org 1)
    const taskRes2 = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${project2Id}/tasks`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'Generate monthly invoices',
        description: 'Aggregate end-of-month subscription usage and email PDF invoices to enterprise customers.',
        priority: 'MEDIUM',
        status: 'TODO',
      })
      .expect(201);
    task2Id = taskRes2.body.data.id;

    // 7. Create Comment in Org 1
    const commentRes = await request(app)
      .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        content: 'Connection pool timeout is set to 5000ms. Consider increasing max connections to 50.',
      })
      .expect(201);
    comment1Id = commentRes.body.data.id;

    // 8. Index Org 1 content into RAG
    await ragService.indexProject(org1Id, project1Id);
    await ragService.indexProject(org1Id, project2Id);
    await ragService.indexTask(org1Id, task1Id);
    await ragService.indexTask(org1Id, task2Id);
    await ragService.indexComment(org1Id, comment1Id);

    // 9. Create Identical Task in Org 2 to test Tenant Isolation
    const org2ProjRes = await request(app)
      .post(`/api/v1/organizations/${org2Id}/projects`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        name: 'Confidential Beta Project',
        key: 'CONF',
        description: 'Confidential internal documents belonging strictly to Org 2',
      })
      .expect(201);

    const org2TaskRes = await request(app)
      .post(`/api/v1/organizations/${org2Id}/projects/${org2ProjRes.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        title: 'Fix overdue database connection pool saturation',
        description: 'Org 2 secret: The primary PostgreSQL cluster connection pool is exhausted.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
      })
      .expect(201);

    await ragService.indexProject(org2Id, org2ProjRes.body.data.id);
    await ragService.indexTask(org2Id, org2TaskRes.body.data.id);
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

  describe('Semantic Retrieval Service', () => {
    it('should retrieve relevant task chunk for query "What tasks are overdue?"', async () => {
      const response = await ragService.retrieve({
        organizationId: org1Id,
        query: 'What tasks are overdue?',
        minSimilarity: 0.1,
        topK: 5,
      });

      expect(response.query).toBe('What tasks are overdue?');
      expect(response.totalMatches).toBeGreaterThan(0);
      expect(response.results.length).toBeGreaterThan(0);

      const firstMatch = response.results[0];
      expect(firstMatch).toBeDefined();
      expect(firstMatch?.organizationId).toBe(org1Id);
      expect(firstMatch?.similarityScore).toBeGreaterThan(0);
      expect(firstMatch?.content).toBeDefined();
    });

    it('should respect topK parameter limiting the number of returned chunks', async () => {
      const response = await ragService.retrieve({
        organizationId: org1Id,
        query: 'database connection pool',
        topK: 2,
        minSimilarity: 0.0,
      });

      expect(response.results.length).toBeLessThanOrEqual(2);
    });

    it('should filter out chunks below minSimilarity threshold', async () => {
      // Threshold 0.99 should filter out dissimilar documents
      const response = await ragService.retrieve({
        organizationId: org1Id,
        query: 'completely unrelated quantum astrophysics string theory topic',
        minSimilarity: 0.95,
      });

      expect(response.results).toHaveLength(0);
    });

    it('should filter by sourceTypes', async () => {
      const response = await ragService.retrieve({
        organizationId: org1Id,
        query: 'connection pool',
        sourceTypes: ['COMMENT'],
        minSimilarity: 0.0,
      });

      expect(response.results.length).toBeGreaterThan(0);
      for (const result of response.results) {
        expect(result.sourceType).toBe('COMMENT');
      }
    });

    it('should filter by projectId', async () => {
      const response = await ragService.retrieve({
        organizationId: org1Id,
        query: 'invoices billing platform',
        projectId: project2Id,
        minSimilarity: 0.0,
      });

      expect(response.results.length).toBeGreaterThan(0);
      for (const result of response.results) {
        const meta = result.metadata as Record<string, unknown> | null;
        expect(meta?.['projectId']).toBe(project2Id);
      }
    });
  });

  describe('Tenant Isolation & Cross-Tenant Attack Prevention', () => {
    it('should NEVER return Organization B knowledge when User 1 searches Organization A', async () => {
      const response = await ragService.retrieve({
        organizationId: org1Id,
        query: 'Confidential Beta Project Org 2 secret',
        minSimilarity: 0.0,
        topK: 10,
      });

      for (const result of response.results) {
        expect(result.organizationId).toBe(org1Id);
        expect(result.organizationId).not.toBe(org2Id);
        expect(result.content).not.toContain('Org 2 secret');
      }
    });

    it('should NEVER return Organization A knowledge when User 2 searches Organization B', async () => {
      const response = await ragService.retrieve({
        organizationId: org2Id,
        query: 'Neural Engine Core tensor optimization',
        minSimilarity: 0.0,
        topK: 10,
      });

      for (const result of response.results) {
        expect(result.organizationId).toBe(org2Id);
        expect(result.organizationId).not.toBe(org1Id);
        expect(result.content).not.toContain('Neural Engine Core');
      }
    });
  });

  describe('HTTP API Endpoints (POST /rag/retrieve)', () => {
    it('should perform semantic retrieval via HTTP POST', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/retrieve`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          query: 'PostgreSQL connection pool exhausted',
          topK: 3,
          minSimilarity: 0.1,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.query).toBe('PostgreSQL connection pool exhausted');
      expect(response.body.data.results).toBeInstanceOf(Array);
      expect(response.body.data.results.length).toBeGreaterThan(0);

      // Verify zero sensitive vector or password leakage
      for (const chunk of response.body.data.results) {
        expect(chunk.embedding).toBeUndefined();
        expect(chunk.similarityScore).toBeDefined();
        expect(chunk.organizationId).toBe(org1Id);
      }
    });

    it('should reject unauthenticated requests with 401', async () => {
      await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/retrieve`)
        .send({ query: 'Hello world' })
        .expect(401);
    });

    it('should reject cross-tenant unauthorized requests with 403 (User 2 accessing Org 1)', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/retrieve`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ query: 'Hello world' })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should reject empty queries with 422 Validation Error', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/rag/retrieve`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ query: '   ' })
        .expect(422);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
