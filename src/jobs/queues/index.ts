import { emailQueue } from './email.queue.js';
import { notificationQueue } from './notification.queue.js';
import { cleanupQueue } from './cleanup.queue.js';
import { ragQueue } from './rag.queue.js';

export const allQueues = [emailQueue, notificationQueue, cleanupQueue, ragQueue] as const;

export async function closeAllQueues(): Promise<void> {
  await Promise.allSettled(allQueues.map((q) => q.close()));
}

export { emailQueue } from './email.queue.js';
export { notificationQueue } from './notification.queue.js';
export { cleanupQueue } from './cleanup.queue.js';
export { ragQueue } from './rag.queue.js';
export * from './queue.config.js';
