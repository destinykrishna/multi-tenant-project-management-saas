import { emailQueue, addEmailJob } from '../../src/jobs/queues/email.queue.js';
import {
  notificationQueue,
  addNotificationJob,
} from '../../src/jobs/queues/notification.queue.js';
import { cleanupQueue, addCleanupJob } from '../../src/jobs/queues/cleanup.queue.js';
import { QUEUE_NAMES, defaultJobOptions } from '../../src/jobs/queues/queue.config.js';
import { startAllWorkers } from '../../src/jobs/workers/index.js';

import { closeAllQueues } from '../../src/jobs/queues/index.js';

describe('BullMQ Infrastructure Tests', () => {
  afterAll(async () => {
    await closeAllQueues();
  });

  describe('Queue Configurations & Options', () => {
    it('should have correct queue names and retry configurations', () => {
      expect(emailQueue.name).toBe(QUEUE_NAMES.EMAIL);
      expect(notificationQueue.name).toBe(QUEUE_NAMES.NOTIFICATION);
      expect(cleanupQueue.name).toBe(QUEUE_NAMES.CLEANUP);

      expect(defaultJobOptions.attempts).toBe(3);
      expect(defaultJobOptions.backoff).toEqual({
        type: 'exponential',
        delay: 1000,
      });
      expect(defaultJobOptions.removeOnComplete).toBeDefined();
      expect(defaultJobOptions.removeOnFail).toBeDefined();
    });
  });

  describe('Job Enqueueing', () => {
    it('should successfully enqueue an email job', async () => {
      const job = await addEmailJob({
        to: 'test@example.com',
        subject: 'Welcome to Expense Analyzer',
        template: 'welcome',
        context: { name: 'Test User' },
      });

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('send-email');
      expect(job.data.to).toBe('test@example.com');

      // Cleanup job from queue
      await job.remove().catch(() => {});
    });

    it('should successfully enqueue a notification job', async () => {
      const job = await addNotificationJob({
        userId: 'user-uuid-123',
        organizationId: 'org-uuid-123',
        type: 'TASK_ASSIGNED',
        title: 'New Task Assigned',
        message: 'You have been assigned to task #101',
      });

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('send-notification');
      expect(job.data.userId).toBe('user-uuid-123');

      await job.remove().catch(() => {});
    });

    it('should successfully enqueue a cleanup job', async () => {
      const job = await addCleanupJob({
        type: 'EXPIRED_SESSIONS',
        olderThanDays: 30,
      });

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('run-cleanup');
      expect(job.data.type).toBe('EXPIRED_SESSIONS');

      await job.remove().catch(() => {});
    });
  });

  describe('Worker Lifecycle & Orchestration', () => {
    it('should start and gracefully stop all background workers without errors', async () => {
      const workers = startAllWorkers();

      expect(workers.emailWorker).toBeDefined();
      expect(workers.notificationWorker).toBeDefined();
      expect(workers.cleanupWorker).toBeDefined();

      // Gracefully stop all workers
      await expect(workers.stop()).resolves.toBeUndefined();
    });
  });
});
