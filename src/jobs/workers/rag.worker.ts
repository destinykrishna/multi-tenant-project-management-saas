import { Worker, type Job } from 'bullmq';
import { logger } from '../../config/logger.js';
import { ragService } from '../../modules/rag/rag.service.js';
import { QUEUE_NAMES, defaultConnection } from '../queues/queue.config.js';
import type { RagJobData } from '../queues/rag.queue.js';

export async function processRagJob(job: Job<RagJobData>): Promise<void> {
  const { type, organizationId, sourceType, sourceId } = job.data;
  logger.info({ jobId: job.id, type, organizationId, sourceType, sourceId }, 'Processing RAG job');

  try {
    switch (type) {
      case 'index-organization-batch': {
        const summary = await ragService.indexOrganizationBatch(organizationId);
        logger.info(
          { jobId: job.id, organizationId, totalChunks: summary.totalChunks },
          'Completed organization RAG batch indexing',
        );
        break;
      }

      case 'index-entity': {
        if (!sourceType || !sourceId) {
          logger.warn({ jobId: job.id }, 'Missing sourceType or sourceId in RAG index-entity job');
          return;
        }

        switch (sourceType) {
          case 'PROJECT':
            await ragService.indexProject(organizationId, sourceId);
            break;
          case 'TASK':
            await ragService.indexTask(organizationId, sourceId);
            break;
          case 'COMMENT':
            await ragService.indexComment(organizationId, sourceId);
            break;
          case 'ACTIVITY_LOG':
            await ragService.indexActivityLog(organizationId, sourceId);
            break;
          default:
            logger.warn({ sourceType, sourceId }, 'Unsupported sourceType for RAG indexing job');
        }
        break;
      }

      case 'delete-entity': {
        if (sourceType && sourceId) {
          await ragService.deleteEntityKnowledge(organizationId, sourceType, sourceId);
          logger.info(
            { jobId: job.id, organizationId, sourceType, sourceId },
            'Deleted entity RAG knowledge',
          );
        }
        break;
      }

      default:
        logger.warn({ type, jobId: job.id }, 'Unknown RAG job type received');
    }
  } catch (err) {
    logger.error(
      { err, jobId: job.id, type, organizationId, sourceType, sourceId },
      'RAG indexing job failed',
    );
    throw err;
  }
}

export function createRagWorker(): Worker<RagJobData> {
  const worker = new Worker<RagJobData>(QUEUE_NAMES.RAG, processRagJob, {
    connection: defaultConnection,
    concurrency: 5,
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'RAG indexing job completed successfully');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'RAG indexing job failed permanently or will retry');
  });

  return worker;
}

export const ragWorker = createRagWorker();
