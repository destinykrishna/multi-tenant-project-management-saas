import type { Worker } from 'bullmq';
import { createEmailWorker } from './email.worker.js';
import { createNotificationWorker } from './notification.worker.js';
import { createCleanupWorker } from './cleanup.worker.js';
import { createRagWorker } from './rag.worker.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { disconnectDatabase } from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';

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

export function shouldRunInlineWorkers(): boolean {
  if (process.env['ENABLE_INLINE_WORKERS'] === 'true') {
    return true;
  }
  if (process.env['ENABLE_INLINE_WORKERS'] === 'false') {
    return false;
  }
  if (env.ENABLE_INLINE_WORKERS !== undefined) {
    return env.ENABLE_INLINE_WORKERS;
  }
  if (process.env['RUN_WORKERS'] === 'true') {
    return true;
  }
  if (process.env['RUN_WORKERS'] === 'false') {
    return false;
  }
  const currentEnv = process.env['NODE_ENV'] ?? env.NODE_ENV;
  // In development, default to inline workers so local dev remains usable without running multiple terminals.
  // In production and test, API processes do not start BullMQ workers (delegated to dedicated worker service).
  return currentEnv === 'development';
}

export function isStandaloneWorkerProcess(): boolean {
  if (process.argv.includes('--run-workers')) {
    return true;
  }
  // If explicitly requested via RUN_WORKERS env var, ensure it's not an API server process
  if (process.env['RUN_WORKERS'] === 'true') {
    const mainScript = process.argv[1] ?? '';
    return !mainScript.includes('server.') && !mainScript.includes('server.js') && !mainScript.includes('server.ts');
  }
  return false;
}

// Support starting independently when executed directly as dedicated worker process
if (isStandaloneWorkerProcess()) {
  const workers = startAllWorkers();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, `Received ${signal}. Shutting down workers gracefully...`);
    await workers.stop();
    await disconnectDatabase();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, 'Unhandled promise rejection in worker process');
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ error }, 'Uncaught exception in worker process');
    void shutdown('uncaughtException');
  });
}

