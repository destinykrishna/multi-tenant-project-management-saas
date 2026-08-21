import { Worker, type Job } from 'bullmq';
import { defaultConnection, QUEUE_NAMES } from '../queues/queue.config.js';
import type { CleanupJobData } from '../queues/cleanup.queue.js';
import { cleanupService } from '../services/cleanup.service.js';
import { logger } from '../../config/logger.js';

export function createCleanupWorker(): Worker<CleanupJobData> {
  const worker = new Worker<CleanupJobData>(
    QUEUE_NAMES.CLEANUP,
    async (job: Job<CleanupJobData>) => {
      logger.info(
        { jobId: job.id, type: job.data.type, olderThanDays: job.data.olderThanDays },
        'Processing cleanup job',
      );

      const result = await cleanupService.executeJob(job.data);
      return result;
    },
    {
      connection: defaultConnection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job: Job<CleanupJobData>) => {
    logger.info({ jobId: job.id, type: job.data.type }, 'Cleanup job completed successfully');
  });

  worker.on('failed', (job: Job<CleanupJobData> | undefined, err: Error) => {
    logger.error(
      { jobId: job?.id, type: job?.data.type, err: err.message },
      'Cleanup job failed processing',
    );
  });

  worker.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Cleanup worker internal error');
  });

  return worker;
}
