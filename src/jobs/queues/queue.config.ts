import type { DefaultJobOptions, ConnectionOptions } from 'bullmq';
import { env } from '../../config/env.js';

export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
  NOTIFICATION: 'notification-queue',
  CLEANUP: 'cleanup-queue',
  RAG: 'rag-queue',
} as const;

export const defaultConnection: ConnectionOptions = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export const defaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    age: 24 * 3600, // retain completed jobs for 24 hours
    count: 500, // keep maximum 500 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // retain failed jobs for 7 days
    count: 1000, // keep maximum 1000 failed jobs for debugging
  },
};
