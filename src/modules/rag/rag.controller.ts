import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { queueRagBatchIndexing, queueRagEntityIndexing } from '../../jobs/queues/rag.queue.js';
import { ragService, type RagService } from './rag.service.js';
import type {
  IndexEntityInput,
  ListKnowledgeQuery,
  RetrieveKnowledgeInput,
  QueryRagInput,
} from './rag.schema.js';

export class RagController {
  constructor(private readonly service: RagService = ragService) {}

  queryKnowledge = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const orgId = req.membership.organizationId;
    const body = req.body as QueryRagInput;

    const result = await this.service.answerQuery({
      organizationId: orgId,
      query: body.query,
      topK: body.topK,
      minSimilarity: body.minSimilarity,
      sourceTypes: body.sourceTypes,
      projectId: body.projectId,
    });

    sendSuccess(res, result, 200, 'Answer generated successfully');
  };

  triggerBatchIndex = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const orgId = req.membership.organizationId;

    // Ingestion runs asynchronously via BullMQ worker unless intentionally requested synchronously via ?sync=true
    const isSync = req.query['sync'] === 'true';

    if (isSync) {
      const summary = await this.service.indexOrganizationBatch(orgId);
      sendSuccess(res, summary, 200, 'Batch RAG indexing completed successfully');
      return;
    }

    const job = await queueRagBatchIndexing(orgId);
    sendSuccess(
      res,
      {
        queued: true,
        jobId: job.id,
        organizationId: orgId,
      },
      202,
      'Batch RAG indexing job enqueued successfully',
    );
  };

  triggerEntityIndex = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const orgId = req.membership.organizationId;
    const body = req.body as IndexEntityInput;
    // Ingestion runs asynchronously via BullMQ worker unless intentionally requested synchronously via ?sync=true
    const isSync = req.query['sync'] === 'true';

    if (isSync) {
      let result;
      switch (body.sourceType) {
        case 'PROJECT':
          result = await this.service.indexProject(orgId, body.sourceId);
          break;
        case 'TASK':
          result = await this.service.indexTask(orgId, body.sourceId);
          break;
        case 'COMMENT':
          result = await this.service.indexComment(orgId, body.sourceId);
          break;
        case 'ACTIVITY_LOG':
          result = await this.service.indexActivityLog(orgId, body.sourceId);
          break;
      }
      sendSuccess(res, result, 200, 'Entity RAG indexing completed successfully');
      return;
    }

    const job = await queueRagEntityIndexing(orgId, body.sourceType, body.sourceId);
    sendSuccess(
      res,
      {
        queued: true,
        jobId: job.id,
        organizationId: orgId,
        sourceType: body.sourceType,
        sourceId: body.sourceId,
      },
      202,
      'Entity RAG indexing job enqueued successfully',
    );
  };

  retrieveKnowledge = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const orgId = req.membership.organizationId;
    const body = req.body as RetrieveKnowledgeInput;

    const result = await this.service.retrieve({
      organizationId: orgId,
      query: body.query,
      topK: body.topK,
      minSimilarity: body.minSimilarity,
      sourceTypes: body.sourceTypes,
      projectId: body.projectId,
    });

    sendSuccess(res, result, 200, 'Relevant knowledge retrieved successfully');
  };

  listKnowledge = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const orgId = req.membership.organizationId;
    const query = req.query as unknown as ListKnowledgeQuery;

    const result = await this.service.getOrganizationKnowledge(orgId, query);
    sendSuccess(res, result, 200, 'Organization RAG knowledge retrieved successfully');
  };

  getStats = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const orgId = req.membership.organizationId;
    const stats = await this.service.getOrganizationStats(orgId);
    sendSuccess(res, stats, 200, 'RAG knowledge stats retrieved successfully');
  };
}

export const ragController = new RagController();
