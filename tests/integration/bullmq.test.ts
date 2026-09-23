import { emailQueue, addEmailJob } from '../../src/jobs/queues/email.queue.js';
import {
  notificationQueue,
  addNotificationJob,
} from '../../src/jobs/queues/notification.queue.js';
import { cleanupQueue, addCleanupJob } from '../../src/jobs/queues/cleanup.queue.js';
import { QUEUE_NAMES, defaultJobOptions } from '../../src/jobs/queues/queue.config.js';
import {
  startAllWorkers,
  shouldRunInlineWorkers,
  isStandaloneWorkerProcess,
} from '../../src/jobs/workers/index.js';

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
      expect(workers.ragWorker).toBeDefined();

      // Gracefully stop all workers
      await expect(workers.stop()).resolves.toBeUndefined();
    });

    describe('Worker Lifecycle Separation (shouldRunInlineWorkers)', () => {
      const originalEnv = { ...process.env };

      afterEach(() => {
        process.env = { ...originalEnv };
      });

      it('should disable inline workers in production by default', () => {
        delete process.env['ENABLE_INLINE_WORKERS'];
        delete process.env['RUN_WORKERS'];
        process.env['NODE_ENV'] = 'production';

        expect(shouldRunInlineWorkers()).toBe(false);
      });

      it('should enable inline workers in development by default', () => {
        delete process.env['ENABLE_INLINE_WORKERS'];
        delete process.env['RUN_WORKERS'];
        process.env['NODE_ENV'] = 'development';

        expect(shouldRunInlineWorkers()).toBe(true);
      });

      it('should disable inline workers in test by default', () => {
        delete process.env['ENABLE_INLINE_WORKERS'];
        delete process.env['RUN_WORKERS'];
        process.env['NODE_ENV'] = 'test';

        expect(shouldRunInlineWorkers()).toBe(false);
      });

      it('should respect ENABLE_INLINE_WORKERS=false explicitly', () => {
        process.env['ENABLE_INLINE_WORKERS'] = 'false';
        process.env['NODE_ENV'] = 'development';

        expect(shouldRunInlineWorkers()).toBe(false);
      });

      it('should respect ENABLE_INLINE_WORKERS=true explicitly', () => {
        process.env['ENABLE_INLINE_WORKERS'] = 'true';
        process.env['NODE_ENV'] = 'production';

        expect(shouldRunInlineWorkers()).toBe(true);
      });

      it('should respect RUN_WORKERS=true explicitly in API process when ENABLE_INLINE_WORKERS is unset', () => {
        delete process.env['ENABLE_INLINE_WORKERS'];
        process.env['RUN_WORKERS'] = 'true';
        process.env['NODE_ENV'] = 'production';

        expect(shouldRunInlineWorkers()).toBe(true);
      });
    });

    describe('Standalone Worker Process Detection (isStandaloneWorkerProcess)', () => {
      const originalArgv = [...process.argv];
      const originalEnv = { ...process.env };

      afterEach(() => {
        process.argv = [...originalArgv];
        process.env = { ...originalEnv };
      });

      it('should identify standalone worker when --run-workers flag is passed', () => {
        process.argv = ['node', 'dist/jobs/workers/index.js', '--run-workers'];

        expect(isStandaloneWorkerProcess()).toBe(true);
      });

      it('should not identify standalone worker when running as server.js', () => {
        process.argv = ['node', 'dist/server.js'];
        delete process.env['RUN_WORKERS'];

        expect(isStandaloneWorkerProcess()).toBe(false);
      });

      it('should not start standalone worker even if RUN_WORKERS=true when running server.js', () => {
        process.argv = ['node', 'dist/server.js'];
        process.env['RUN_WORKERS'] = 'true';

        expect(isStandaloneWorkerProcess()).toBe(false);
      });

      it('should identify standalone worker when RUN_WORKERS=true and entrypoint is worker index', () => {
        process.argv = ['node', 'dist/jobs/workers/index.js'];
        process.env['RUN_WORKERS'] = 'true';

        expect(isStandaloneWorkerProcess()).toBe(true);
      });
    });
  });
});
