import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';
import type { CreateKnowledgeChunkInput, RagRetrievedChunk, RagSourceType } from './rag.types.js';

export class RagRepository {
  async upsertChunk(data: CreateKnowledgeChunkInput) {
    const vectorLiteral = `[${data.embedding.join(',')}]`;
    const metadataJson = JSON.stringify(data.metadata ?? {});

    const rows = await prisma.$queryRaw<
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
    >`
      INSERT INTO "rag_knowledge_documents" (
        "id",
        "organizationId",
        "sourceType",
        "sourceId",
        "chunkIndex",
        "totalChunks",
        "title",
        "content",
        "metadata",
        "embedding",
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        ${data.organizationId},
        ${data.sourceType}::"RagSourceType",
        ${data.sourceId},
        ${data.chunkIndex},
        ${data.totalChunks},
        ${data.title ?? null},
        ${data.content},
        ${metadataJson}::jsonb,
        ${vectorLiteral}::vector,
        NOW(),
        NOW()
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
        "id",
        "organizationId",
        "sourceType",
        "sourceId",
        "chunkIndex",
        "totalChunks",
        "title",
        "content",
        "metadata",
        "createdAt",
        "updatedAt"
    `;

    return rows[0];
  }

  async deleteOrphanChunks(
    organizationId: string,
    sourceType: RagSourceType,
    sourceId: string,
    currentTotalChunks: number,
  ) {
    return prisma.ragKnowledgeDocument.deleteMany({
      where: {
        organizationId,
        sourceType,
        sourceId,
        chunkIndex: {
          gte: currentTotalChunks,
        },
      },
    });
  }

  async deleteBySource(organizationId: string, sourceType: RagSourceType, sourceId: string) {
    return prisma.ragKnowledgeDocument.deleteMany({
      where: {
        organizationId,
        sourceType,
        sourceId,
      },
    });
  }

  async findByOrganization(
    organizationId: string,
    options: {
      sourceType?: RagSourceType;
      sourceId?: string;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const where = {
      organizationId,
      ...(options.sourceType ? { sourceType: options.sourceType } : {}),
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.ragKnowledgeDocument.findMany({
        where,
        skip: options.skip,
        take: options.take,
        orderBy: [{ createdAt: 'desc' }, { chunkIndex: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          sourceType: true,
          sourceId: true,
          chunkIndex: true,
          totalChunks: true,
          title: true,
          content: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.ragKnowledgeDocument.count({ where }),
    ]);

    return { items, total };
  }

  async countByOrganization(organizationId: string) {
    const grouped = await prisma.ragKnowledgeDocument.groupBy({
      by: ['sourceType'],
      where: { organizationId },
      _count: { _all: true },
    });

    const bySourceType: Record<string, number> = {};
    let totalDocuments = 0;

    for (const group of grouped) {
      bySourceType[group.sourceType] = group._count._all;
      totalDocuments += group._count._all;
    }

    return { totalDocuments, bySourceType };
  }

  async searchVectors(options: {
    organizationId: string;
    queryEmbedding: number[];
    topK: number;
    minSimilarity: number;
    sourceTypes?: RagSourceType[];
    projectId?: string;
  }): Promise<RagRetrievedChunk[]> {
    const vectorLiteral = `[${options.queryEmbedding.join(',')}]`;

    // 1. Base conditions: strictly tenant-scoped, non-null embedding, and threshold filter
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"organizationId" = ${options.organizationId}`,
      Prisma.sql`"embedding" IS NOT NULL`,
      Prisma.sql`(1 - ("embedding" <=> ${vectorLiteral}::vector)) >= ${options.minSimilarity}`,
    ];

    // 2. Filter by source types if specified
    if (options.sourceTypes && options.sourceTypes.length > 0) {
      conditions.push(Prisma.sql`"sourceType" IN (${Prisma.join(options.sourceTypes)})`);
    }

    // 3. Filter by projectId if specified (matching PROJECT entity or nested metadata)
    if (options.projectId) {
      conditions.push(
        Prisma.sql`(("sourceType" = 'PROJECT' AND "sourceId" = ${options.projectId}) OR ("metadata"->>'projectId' = ${options.projectId}))`,
      );
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    // 4. Execute vector similarity search directly inside PostgreSQL using <=> cosine distance
    const rows = await prisma.$queryRaw<
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
        similarityScore: number;
      }>
    >`
      SELECT
        "id",
        "organizationId",
        "sourceType",
        "sourceId",
        "chunkIndex",
        "totalChunks",
        "title",
        "content",
        "metadata",
        ROUND((1 - ("embedding" <=> ${vectorLiteral}::vector))::numeric, 4)::float AS "similarityScore"
      FROM "rag_knowledge_documents"
      WHERE ${whereClause}
      ORDER BY "embedding" <=> ${vectorLiteral}::vector ASC
      LIMIT ${options.topK}
    `;

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chunkIndex: row.chunkIndex,
      totalChunks: row.totalChunks,
      title: row.title,
      content: row.content,
      metadata: row.metadata as Prisma.JsonValue | null,
      similarityScore: row.similarityScore,
    }));
  }

  async deleteByOrganization(organizationId: string) {
    return prisma.ragKnowledgeDocument.deleteMany({
      where: { organizationId },
    });
  }
}

export const ragRepository = new RagRepository();
