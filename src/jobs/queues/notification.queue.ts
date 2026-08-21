import { Queue, type JobsOptions } from 'bullmq';
import { defaultConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config.js';

export interface NotificationJobData {
  userId: string;
  organizationId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export const notificationQueue = new Queue<NotificationJobData>(QUEUE_NAMES.NOTIFICATION, {
  connection: defaultConnection,
  defaultJobOptions,
});

export async function addNotificationJob(data: NotificationJobData, options?: JobsOptions) {
  return notificationQueue.add('send-notification', data, options);
}
