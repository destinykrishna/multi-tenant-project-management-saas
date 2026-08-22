import { prisma } from '../../config/database.js';
import type { CreateKnowledgeChunkInput, RagSourceType } from './rag.types.js';
import { cosineSimilarity } from './utils/vector.util.js';

export class RagRepository {
  async upsertChunk(data: CreateKnowledgeChunkInput) {
    return prisma.ragKnowledgeDocument.upsert({
      where: {
        organizationId_sourceType_sourceId_chunkIndex: {
          organizationId: data.organizationId,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          chunkIndex: data.chunkIndex,
        },
      },
      update: {
        totalChunks: data.totalChunks,
        title: data.title,
        content: data.content,
        metadata: data.metadata ?? undefined,
        embedding: data.embedding,
      },
      create: {
        organizationId: data.organizationId,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks,
        title: data.title,
        content: data.content,
        metadata: data.metadata ?? undefined,
        embedding: data.embedding,
      },
    });
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
  }) {
    // 1. Strictly enforce organizationId filter at the database query level
    const where: {
      organizationId: string;
      sourceType?: { in: RagSourceType[] };
    } = {
      organizationId: options.organizationId,
    };

    if (options.sourceTypes && options.sourceTypes.length > 0) {
      where.sourceType = { in: options.sourceTypes };
    }

    // 2. Fetch candidates belonging to this organization
    const candidates = await prisma.ragKnowledgeDocument.findMany({
      where,
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
        embedding: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 3. Compute cosine similarity & filter by threshold
    const scoredChunks = candidates
      .map((doc) => {
        // Optional projectId filter
        if (options.projectId) {
          const metaObj = doc.metadata as Record<string, unknown> | null;
          const entityProjectId =
            doc.sourceType === 'PROJECT'
              ? doc.sourceId
              : (metaObj?.['projectId'] as string | undefined);

          if (entityProjectId !== options.projectId) {
            return null;
          }
        }

        const similarityScore = cosineSimilarity(options.queryEmbedding, doc.embedding);
        return {
          id: doc.id,
          organizationId: doc.organizationId,
          sourceType: doc.sourceType,
          sourceId: doc.sourceId,
          chunkIndex: doc.chunkIndex,
          totalChunks: doc.totalChunks,
          title: doc.title,
          content: doc.content,
          metadata: doc.metadata,
          similarityScore: Math.round(similarityScore * 10000) / 10000,
        };
      })
      .filter(
        (doc): doc is NonNullable<typeof doc> =>
          doc !== null && doc.similarityScore >= options.minSimilarity,
      );

    // 4. Sort descending by similarity score
    scoredChunks.sort((a, b) => b.similarityScore - a.similarityScore);

    // 5. Return topK chunks
    return scoredChunks.slice(0, options.topK);
  }

  async deleteByOrganization(organizationId: string) {
    return prisma.ragKnowledgeDocument.deleteMany({
      where: { organizationId },
    });
  }
}

export const ragRepository = new RagRepository();
