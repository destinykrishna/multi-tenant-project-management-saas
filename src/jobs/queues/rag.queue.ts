import { Queue, type JobsOptions } from 'bullmq';
import type { RagSourceType } from '../../modules/rag/rag.types.js';
import { defaultConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config.js';

export type RagJobType = 'index-entity' | 'index-organization-batch' | 'delete-entity';

export interface RagJobData {
  type: RagJobType;
  organizationId: string;
  sourceType?: RagSourceType;
  sourceId?: string;
}

export const ragQueue = new Queue<RagJobData>(QUEUE_NAMES.RAG, {
  connection: defaultConnection,
  defaultJobOptions,
});

export async function queueRagEntityIndexing(
  organizationId: string,
  sourceType: RagSourceType,
  sourceId: string,
  options?: JobsOptions,
) {
  return ragQueue.add(
    'index-entity',
    {
      type: 'index-entity',
      organizationId,
      sourceType,
      sourceId,
    },
    options,
  );
}

export async function queueRagBatchIndexing(organizationId: string, options?: JobsOptions) {
  return ragQueue.add(
    'index-organization-batch',
    {
      type: 'index-organization-batch',
      organizationId,
    },
    options,
  );
}

export async function queueRagEntityDeletion(
  organizationId: string,
  sourceType: RagSourceType,
  sourceId: string,
  options?: JobsOptions,
) {
  return ragQueue.add(
    'delete-entity',
    {
      type: 'delete-entity',
      organizationId,
      sourceType,
      sourceId,
    },
    options,
  );
}
