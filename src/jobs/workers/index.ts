import type { Worker } from 'bullmq';
import { createEmailWorker } from './email.worker.js';
import { createNotificationWorker } from './notification.worker.js';
import { createCleanupWorker } from './cleanup.worker.js';
import { createRagWorker } from './rag.worker.js';
import { logger } from '../../config/logger.js';

export interface RunningWorkers {
  emailWorker: Worker;
  notificationWorker: Worker;
  cleanupWorker: Worker;
  ragWorker: Worker;
  stop: () => Promise<void>;
}

export function startAllWorkers(): RunningWorkers {
  logger.info('Starting BullMQ background workers...');

  const emailWorker = createEmailWorker();
  const notificationWorker = createNotificationWorker();
  const cleanupWorker = createCleanupWorker();
  const ragWorker = createRagWorker();

  const stop = async () => {
    logger.info('Stopping all BullMQ workers...');
    const workers = [emailWorker, notificationWorker, cleanupWorker, ragWorker];
    await Promise.allSettled(workers.map((w) => w.waitUntilReady()));
    await Promise.allSettled(workers.map((w) => w.close(true)));
    logger.info('All BullMQ workers stopped');
  };

  return {
    emailWorker,
    notificationWorker,
    cleanupWorker,
    ragWorker,
    stop,
  };
}

// Support starting independently when executed directly
if (process.env['RUN_WORKERS'] === 'true' || process.argv.includes('--run-workers')) {
  const workers = startAllWorkers();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, `Received ${signal}. Shutting down workers gracefully...`);
    await workers.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}
