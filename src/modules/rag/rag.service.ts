import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import {
  formatProjectContent,
  formatTaskContent,
  formatCommentContent,
  formatActivityLogContent,
} from './formatters/entity.formatter.js';
import { defaultEmbeddingProvider } from './providers/embedding.provider.js';
import { defaultLlmProvider } from './providers/llm.provider.js';
import { ragRepository, type RagRepository } from './rag.repository.js';
import { buildRagMessages } from './prompts/rag.prompt.js';
import type {
  IEmbeddingProvider,
  ILlmProvider,
  RagSourceType,
  EntityIngestionResult,
  BatchIngestionSummary,
  RagKnowledgeDocumentResponse,
  RagStatsResponse,
  RagRetrieveOptions,
  RagRetrievalResponse,
  RagQueryOptions,
  RagSourceReference,
  RagQueryResponse,
} from './rag.types.js';
import { chunkText } from './utils/chunker.js';

export class RagService {
  constructor(
    private readonly repo: RagRepository = ragRepository,
    private readonly embeddingProvider: IEmbeddingProvider = defaultEmbeddingProvider,
    private readonly llmProvider: ILlmProvider = defaultLlmProvider,
  ) {}

  async indexEntity(
    organizationId: string,
    sourceType: RagSourceType,
    sourceId: string,
    title: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<EntityIngestionResult> {
    const chunks = chunkText(content);
    if (chunks.length === 0) {
      return { sourceType, sourceId, chunksCreated: 0, success: true };
    }

    try {
      // 1. Generate embeddings in batch for all chunks of the entity
      const embeddings = await this.embeddingProvider.generateEmbeddings(chunks);

      // 2. Deterministically upsert each chunk into PostgreSQL
      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i] ?? '';
        const embedding = embeddings[i] ?? [];

        await this.repo.upsertChunk({
          organizationId,
          sourceType,
          sourceId,
          chunkIndex: i,
          totalChunks: chunks.length,
          title,
          content: chunkContent,
          metadata: {
            ...metadata,
            chunkIndex: i,
            totalChunks: chunks.length,
            characterCount: chunkContent.length,
          },
          embedding,
        });
      }

      // 3. Clean up any stale chunks if the updated entity now has fewer chunks
      await this.repo.deleteOrphanChunks(organizationId, sourceType, sourceId, chunks.length);

      logger.debug(
        { organizationId, sourceType, sourceId, chunksCreated: chunks.length },
        'Entity successfully indexed for RAG',
      );

      return {
        sourceType,
        sourceId,
        chunksCreated: chunks.length,
        success: true,
      };
    } catch (err) {
      logger.error({ err, organizationId, sourceType, sourceId }, 'Failed to index entity for RAG');
      throw err;
    }
  }

  async indexProject(organizationId: string, projectId: string): Promise<EntityIngestionResult> {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId },
      include: {
        createdBy: { select: { name: true, email: true } },
      },
    });

    if (!project) {
      throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
    }

    const { title, content, metadata } = formatProjectContent(project);
    return this.indexEntity(organizationId, 'PROJECT', projectId, title, content, metadata);
  }

  async indexTask(organizationId: string, taskId: string): Promise<EntityIngestionResult> {
    const task = await prisma.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      include: {
        project: { select: { id: true, name: true, key: true, organizationId: true } },
        assignee: { select: { name: true, email: true } },
        createdBy: { select: { name: true, email: true } },
      },
    });

    if (!task) {
      throw new NotFoundError('Task not found in this organization', 'TASK_NOT_FOUND');
    }

    const { title, content, metadata } = formatTaskContent(task);
    return this.indexEntity(organizationId, 'TASK', taskId, title, content, metadata);
  }

  async indexComment(organizationId: string, commentId: string): Promise<EntityIngestionResult> {
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, task: { project: { organizationId } } },
      include: {
        user: { select: { name: true, email: true } },
        task: {
          select: {
            id: true,
            title: true,
            project: { select: { id: true, name: true, key: true, organizationId: true } },
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundError('Comment not found in this organization', 'COMMENT_NOT_FOUND');
    }

    const { title, content, metadata } = formatCommentContent(comment);
    return this.indexEntity(organizationId, 'COMMENT', commentId, title, content, metadata);
  }

  async indexActivityLog(
    organizationId: string,
    activityId: string,
  ): Promise<EntityIngestionResult> {
    const activity = await prisma.activityLog.findFirst({
      where: { id: activityId, organizationId },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    if (!activity) {
      throw new NotFoundError('Activity log not found in this organization', 'ACTIVITY_NOT_FOUND');
    }

    const { title, content, metadata } = formatActivityLogContent(activity);
    return this.indexEntity(organizationId, 'ACTIVITY_LOG', activityId, title, content, metadata);
  }

  async indexOrganizationBatch(organizationId: string): Promise<BatchIngestionSummary> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!org) {
      throw new NotFoundError('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    logger.info({ organizationId }, 'Starting batch RAG indexing for organization');

    let projectsIndexed = 0;
    let tasksIndexed = 0;
    let commentsIndexed = 0;
    let activitiesIndexed = 0;
    let totalChunks = 0;

    // 1. Index all Projects
    const projects = await prisma.project.findMany({
      where: { organizationId },
      include: { createdBy: { select: { name: true, email: true } } },
    });
    for (const project of projects) {
      const { title, content, metadata } = formatProjectContent(project);
      const res = await this.indexEntity(
        organizationId,
        'PROJECT',
        project.id,
        title,
        content,
        metadata,
      );
      projectsIndexed++;
      totalChunks += res.chunksCreated;
    }

    // 2. Index all Tasks
    const tasks = await prisma.task.findMany({
      where: { project: { organizationId } },
      include: {
        project: { select: { id: true, name: true, key: true } },
        assignee: { select: { name: true, email: true } },
        createdBy: { select: { name: true, email: true } },
      },
    });
    for (const task of tasks) {
      const { title, content, metadata } = formatTaskContent(task);
      const res = await this.indexEntity(organizationId, 'TASK', task.id, title, content, metadata);
      tasksIndexed++;
      totalChunks += res.chunksCreated;
    }

    // 3. Index all Comments
    const comments = await prisma.comment.findMany({
      where: { task: { project: { organizationId } } },
      include: {
        user: { select: { name: true, email: true } },
        task: {
          select: {
            id: true,
            title: true,
            project: { select: { id: true, name: true, key: true } },
          },
        },
      },
    });
    for (const comment of comments) {
      const { title, content, metadata } = formatCommentContent(comment);
      const res = await this.indexEntity(
        organizationId,
        'COMMENT',
        comment.id,
        title,
        content,
        metadata,
      );
      commentsIndexed++;
      totalChunks += res.chunksCreated;
    }

    // 4. Index recent Activity Logs (last 500 for bounded indexing)
    const activities = await prisma.activityLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        user: { select: { name: true, email: true } },
      },
    });
    for (const activity of activities) {
      const { title, content, metadata } = formatActivityLogContent(activity);
      const res = await this.indexEntity(
        organizationId,
        'ACTIVITY_LOG',
        activity.id,
        title,
        content,
        metadata,
      );
      activitiesIndexed++;
      totalChunks += res.chunksCreated;
    }

    logger.info(
      {
        organizationId,
        projectsIndexed,
        tasksIndexed,
        commentsIndexed,
        activitiesIndexed,
        totalChunks,
      },
      'Batch RAG indexing completed successfully for organization',
    );

    return {
      organizationId,
      projectsIndexed,
      tasksIndexed,
      commentsIndexed,
      activitiesIndexed,
      totalChunks,
    };
  }

  async deleteEntityKnowledge(
    organizationId: string,
    sourceType: RagSourceType,
    sourceId: string,
  ): Promise<{ deleted: boolean }> {
    await this.repo.deleteBySource(organizationId, sourceType, sourceId);
    return { deleted: true };
  }

  async getOrganizationKnowledge(
    organizationId: string,
    options: {
      page?: number;
      limit?: number;
      sourceType?: RagSourceType;
      sourceId?: string;
    } = {},
  ): Promise<PaginatedResponse<RagKnowledgeDocumentResponse>> {
    const { page, limit, skip, take } = getPaginationOffset(options.page, options.limit);

    const { items, total } = await this.repo.findByOrganization(organizationId, {
      sourceType: options.sourceType,
      sourceId: options.sourceId,
      skip,
      take,
    });

    const sanitizedItems: RagKnowledgeDocumentResponse[] = items.map((item) => ({
      id: item.id,
      organizationId: item.organizationId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      chunkIndex: item.chunkIndex,
      totalChunks: item.totalChunks,
      title: item.title,
      content: item.content,
      metadata: item.metadata,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return buildPaginatedResponse(sanitizedItems, total, page, limit);
  }

  async getOrganizationStats(organizationId: string): Promise<RagStatsResponse> {
    return this.repo.countByOrganization(organizationId);
  }

  async retrieve(options: RagRetrieveOptions): Promise<RagRetrievalResponse> {
    const trimmedQuery = options.query.trim();
    if (!trimmedQuery) {
      throw new ValidationError('Query must not be empty', {
        query: ['Query must be a non-empty string'],
      });
    }

    const topK = options.topK ?? env.RAG_DEFAULT_TOP_K;
    const minSimilarity = options.minSimilarity ?? env.RAG_MIN_SIMILARITY_THRESHOLD;

    logger.debug(
      { organizationId: options.organizationId, query: trimmedQuery, topK, minSimilarity },
      'Generating query embedding for RAG retrieval',
    );

    // 1. Generate query embedding using the configured embedding provider
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(trimmedQuery);

    // 2. Perform tenant-scoped vector similarity search
    const results = await this.repo.searchVectors({
      organizationId: options.organizationId,
      queryEmbedding,
      topK,
      minSimilarity,
      sourceTypes: options.sourceTypes,
      projectId: options.projectId,
    });

    logger.debug(
      { organizationId: options.organizationId, matchesFound: results.length },
      'RAG retrieval search completed',
    );

    return {
      query: trimmedQuery,
      totalMatches: results.length,
      results,
    };
  }

  async answerQuery(options: RagQueryOptions): Promise<RagQueryResponse> {
    const trimmedQuery = options.query.trim();
    if (!trimmedQuery) {
      throw new ValidationError('Query must not be empty', {
        query: ['Query must be a non-empty string'],
      });
    }

    const topK = options.topK ?? env.RAG_DEFAULT_TOP_K;
    const minSimilarity = options.minSimilarity ?? env.RAG_MIN_SIMILARITY_THRESHOLD;

    // 1. Retrieve tenant-scoped context chunks
    const retrieval = await this.retrieve({
      organizationId: options.organizationId,
      query: trimmedQuery,
      topK,
      minSimilarity,
      sourceTypes: options.sourceTypes,
      projectId: options.projectId,
    });

    // 2. Format source references
    const sources: RagSourceReference[] = retrieval.results.map((chunk) => ({
      id: chunk.id,
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      title: chunk.title,
      chunkIndex: chunk.chunkIndex,
      similarityScore: chunk.similarityScore,
      metadata: chunk.metadata,
    }));

    // 3. If zero chunks retrieved, return grounded fallback without wasting LLM tokens
    if (retrieval.results.length === 0) {
      return {
        query: trimmedQuery,
        answer:
          'The available organization data does not contain enough information to answer this question.',
        sources: [],
      };
    }

    // 4. Build prompt with strict prompt injection defense and bounded context
    const messages = buildRagMessages(trimmedQuery, retrieval.results, env.RAG_MAX_CONTEXT_LENGTH);

    // 5. Generate grounded response from LLM
    const answer = await this.llmProvider.generateResponse(messages, {
      temperature: 0.1,
    });

    return {
      query: trimmedQuery,
      answer,
      sources,
    };
  }
}

export const ragService = new RagService();
