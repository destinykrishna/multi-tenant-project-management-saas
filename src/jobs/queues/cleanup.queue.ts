import { Queue, type JobsOptions } from 'bullmq';
import { defaultConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config.js';

export interface CleanupJobData {
  type: 'ALL' | 'EXPIRED_SESSIONS' | 'STALE_NOTIFICATIONS' | 'TEMP_DATA';
  olderThanDays?: number;
  batchSize?: number;
}

export const cleanupQueue = new Queue<CleanupJobData>(QUEUE_NAMES.CLEANUP, {
  connection: defaultConnection,
  defaultJobOptions,
});

export async function addCleanupJob(data: CleanupJobData, options?: JobsOptions) {
  return cleanupQueue.add('run-cleanup', data, options);
}

export async function scheduleRecurringCleanupJob(
  cronPattern = '0 3 * * *',
  data: CleanupJobData = { type: 'ALL', olderThanDays: 30, batchSize: 500 },
) {
  return cleanupQueue.upsertJobScheduler(
    'recurring-daily-cleanup',
    { pattern: cronPattern },
    {
      name: 'recurring-daily-cleanup',
      data,
    },
  );
}
