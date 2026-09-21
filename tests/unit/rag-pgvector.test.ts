import { ragRepository } from '../../src/modules/rag/rag.repository.js';
import { prisma } from '../../src/config/database.js';
import type { RagSourceType } from '../../src/modules/rag/rag.types.js';

describe('RAG PostgreSQL pgvector Repository Layer', () => {
  let queryRawSpy: jest.SpyInstance;

  beforeEach(() => {
    queryRawSpy = jest.spyOn(prisma, '$queryRaw').mockReset();
  });

  afterEach(() => {
    queryRawSpy.mockRestore();
  });

  describe('searchVectors', () => {
    const orgId = 'org-uuid-1234';
    const mockEmbedding = new Array(1536).fill(0.05);

    it('should perform successful vector retrieval with correct result mapping', async () => {
      const mockDbRow = {
        id: 'chunk-1',
        organizationId: orgId,
        sourceType: 'TASK' as RagSourceType,
        sourceId: 'task-100',
        chunkIndex: 0,
        totalChunks: 1,
        title: 'Fix database connection pool',
        content: 'Database connection pool is exhausted and needs scaling.',
        metadata: { priority: 'HIGH', projectId: 'proj-1' },
        similarityScore: 0.9421,
      };

      queryRawSpy.mockResolvedValueOnce([mockDbRow]);

      const results = await ragRepository.searchVectors({
        organizationId: orgId,
        queryEmbedding: mockEmbedding,
        topK: 5,
        minSimilarity: 0.5,
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'chunk-1',
        organizationId: orgId,
        sourceType: 'TASK',
        sourceId: 'task-100',
        chunkIndex: 0,
        totalChunks: 1,
        title: 'Fix database connection pool',
        content: 'Database connection pool is exhausted and needs scaling.',
        metadata: { priority: 'HIGH', projectId: 'proj-1' },
        similarityScore: 0.9421,
      });
    });

    it('should enforce correct similarity ordering (ORDER BY <=> ASC)', async () => {
      queryRawSpy.mockResolvedValueOnce([]);

      await ragRepository.searchVectors({
        organizationId: orgId,
        queryEmbedding: mockEmbedding,
        topK: 5,
        minSimilarity: 0.5,
      });

      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      const call = queryRawSpy.mock.calls[0];
      const sqlText = (call?.[0] as string[]).join('?');
      expect(sqlText).toContain('ORDER BY "embedding" <=> ');
      expect(sqlText).toContain('::vector ASC');
    });

    it('should enforce topK parameter as SQL LIMIT', async () => {
      queryRawSpy.mockResolvedValueOnce([]);

      await ragRepository.searchVectors({
        organizationId: orgId,
        queryEmbedding: mockEmbedding,
        topK: 7,
        minSimilarity: 0.3,
      });

      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      const call = queryRawSpy.mock.calls[0];
      const sqlText = (call?.[0] as string[]).join('?');
      const values = call?.slice(1);

      expect(sqlText).toContain('LIMIT ');
      expect(values).toContain(7);
    });

    it('should filter by minSimilarity threshold directly in PostgreSQL SQL', async () => {
      queryRawSpy.mockResolvedValueOnce([]);

      await ragRepository.searchVectors({
        organizationId: orgId,
        queryEmbedding: mockEmbedding,
        topK: 10,
        minSimilarity: 0.85,
      });

      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      const call = queryRawSpy.mock.calls[0];
      const whereClause = call?.[2]; // whereClause is passed as a Prisma.Sql object in interpolation
      const whereSql = whereClause?.strings ? whereClause.strings.join('?') : JSON.stringify(call);

      expect(whereSql).toContain('(1 - ("embedding" <=> ');
      expect(whereSql).toContain('::vector)) >= ');
      expect(whereClause.values).toContain(0.85);
    });

    it('should strictly enforce cross-tenant retrieval isolation in SQL WHERE clause', async () => {
      queryRawSpy.mockResolvedValueOnce([]);

      await ragRepository.searchVectors({
        organizationId: 'tenant-a-strictly-isolated',
        queryEmbedding: mockEmbedding,
        topK: 5,
        minSimilarity: 0.5,
      });

      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      const call = queryRawSpy.mock.calls[0];
      const whereClause = call?.[2];
      const whereSql = whereClause?.strings ? whereClause.strings.join('?') : JSON.stringify(call);

      expect(whereSql).toContain('"organizationId" = ');
      expect(whereClause.values).toContain('tenant-a-strictly-isolated');
    });

    it('should return empty array when no chunks match criteria', async () => {
      queryRawSpy.mockResolvedValueOnce([]);

      const results = await ragRepository.searchVectors({
        organizationId: orgId,
        queryEmbedding: mockEmbedding,
        topK: 5,
        minSimilarity: 0.99,
      });

      expect(results).toEqual([]);
    });

    it('should NOT select embedding column into Node.js (memory-efficient streaming)', async () => {
      queryRawSpy.mockResolvedValueOnce([]);

      await ragRepository.searchVectors({
        organizationId: orgId,
        queryEmbedding: mockEmbedding,
        topK: 5,
        minSimilarity: 0.5,
      });

      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      const call = queryRawSpy.mock.calls[0];
      const rawSql = (call?.[0] as string[]).join('');

      // Verify that "embedding" is not in the SELECT list (only used in distance math & WHERE)
      const selectPart = rawSql.split('FROM')[0] ?? '';
      expect(selectPart).not.toMatch(/"embedding"\s*,/);
      expect(selectPart).not.toMatch(/SELECT\s+.*\bembedding\b\s+FROM/);
      expect(selectPart).toContain('"similarityScore"');
    });

    it('should apply optional sourceType and projectId filters in SQL', async () => {
      queryRawSpy.mockResolvedValueOnce([]);

      await ragRepository.searchVectors({
        organizationId: orgId,
        queryEmbedding: mockEmbedding,
        topK: 5,
        minSimilarity: 0.5,
        sourceTypes: ['COMMENT', 'TASK'],
        projectId: 'project-xyz',
      });

      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      const call = queryRawSpy.mock.calls[0];
      const whereClause = call?.[2];
      const whereSql = whereClause?.strings ? whereClause.strings.join('?') : '';

      expect(whereSql).toContain('"sourceType" IN');
      expect(whereSql).toContain('"sourceType" = \'PROJECT\'');
      expect(whereSql).toContain('"metadata"->>\'projectId\'');
      expect(whereClause.values).toContain('COMMENT');
      expect(whereClause.values).toContain('TASK');
      expect(whereClause.values).toContain('project-xyz');
    });
  });

  describe('upsertChunk', () => {
    it('should persist vector embedding using parameterized SQL with ::vector cast and ON CONFLICT', async () => {
      const mockResult = {
        id: 'chunk-123',
        organizationId: 'org-1',
        sourceType: 'PROJECT' as RagSourceType,
        sourceId: 'proj-1',
        chunkIndex: 0,
        totalChunks: 1,
        title: 'Project Title',
        content: 'Project content details',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queryRawSpy.mockResolvedValueOnce([mockResult]);

      const res = await ragRepository.upsertChunk({
        organizationId: 'org-1',
        sourceType: 'PROJECT',
        sourceId: 'proj-1',
        chunkIndex: 0,
        totalChunks: 1,
        title: 'Project Title',
        content: 'Project content details',
        metadata: { category: 'CORE' },
        embedding: [0.1, 0.2, 0.3],
      });

      expect(res).toEqual(mockResult);
      expect(queryRawSpy).toHaveBeenCalledTimes(1);

      const call = queryRawSpy.mock.calls[0];
      const sqlText = (call?.[0] as string[]).join('?');

      expect(sqlText).toContain('INSERT INTO "rag_knowledge_documents"');
      expect(sqlText).toContain('::vector');
      expect(sqlText).toContain('ON CONFLICT ("organizationId", "sourceType", "sourceId", "chunkIndex")');
      expect(sqlText).toContain('DO UPDATE SET');
      expect(sqlText).toContain('"embedding" = EXCLUDED."embedding"');
    });
  });
});
