import { Queue, type JobsOptions } from 'bullmq';
import { defaultConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config.js';

export interface EmailJobData {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  template?: string;
  context?: Record<string, unknown>;
  from?: string;
}

export const emailQueue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, {
  connection: defaultConnection,
  defaultJobOptions,
});

export async function addEmailJob(data: EmailJobData, options?: JobsOptions) {
  return emailQueue.add('send-email', data, options);
}
