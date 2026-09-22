import { emailQueue } from './email.queue.js';
import { notificationQueue } from './notification.queue.js';
import { cleanupQueue } from './cleanup.queue.js';
import { ragQueue } from './rag.queue.js';

export const allQueues = [emailQueue, notificationQueue, cleanupQueue, ragQueue] as const;

function destroyRedisClient(client: any): void {
  if (!client) return;
  try {
    client.disconnect(false);
    client.connector?.stream?.destroy();
  } catch {}
}

export async function closeAllQueues(): Promise<void> {
  await Promise.allSettled(allQueues.map((q) => q.close()));
  for (const q of allQueues) {
    const backend = (q as any).getBackend?.() || (q as any).backend;
    destroyRedisClient(backend?.connection?._client);
    destroyRedisClient(backend?.blockingConnection?._client);
  }
}

export { emailQueue } from './email.queue.js';
export { notificationQueue } from './notification.queue.js';
export { cleanupQueue } from './cleanup.queue.js';
export { ragQueue } from './rag.queue.js';
export * from './queue.config.js';
