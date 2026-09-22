import { QueueEvents } from 'bullmq';
import { emailService } from '../../src/config/email.js';
import { emailQueue } from '../../src/jobs/queues/email.queue.js';
import { createEmailWorker } from '../../src/jobs/workers/email.worker.js';
import { defaultConnection } from '../../src/jobs/queues/queue.config.js';

describe('Email Service & Worker Integration Tests', () => {
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    queueEvents = new QueueEvents(emailQueue.name, { connection: defaultConnection });
    await queueEvents.waitUntilReady();
  });

  afterAll(async () => {
    await queueEvents.close();
    await emailQueue.close();
  });

  describe('Nodemailer Transport Service', () => {
    it('should send direct email using the configured transport', async () => {
      const result = await emailService.sendDirect({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'This is a plain text test body.',
        html: '<p>This is a test body.</p>',
      });

      expect(result).toBeDefined();
      expect(result.messageId).toBeDefined();
    });

    it('should queue an email job in BullMQ without blocking', async () => {
      const job = await emailService.queueEmail({
        to: 'queue-recipient@example.com',
        subject: 'Queued Welcome Email',
        text: 'Welcome to our platform!',
      });

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('send-email');
      expect(job.data.to).toBe('queue-recipient@example.com');

      await job.remove().catch(() => {});
    });
  });

  describe('Email Worker Processing', () => {
    it('should process a queued email job via the worker', async () => {
      const worker = createEmailWorker();
      await worker.waitUntilReady();

      try {
        const job = await emailService.queueEmail({
          to: 'processed@example.com',
          subject: 'Processed By Worker',
          html: '<h1>Success</h1>',
        });

        // Wait for job completion via queueEvents
        const completedResult = (await job.waitUntilFinished(queueEvents, 10000)) as {
          sent: boolean;
          recipient: string;
          messageId: string;
        };

        expect(completedResult).toBeDefined();
        expect(completedResult.sent).toBe(true);
        expect(completedResult.recipient).toBe('processed@example.com');
        expect(completedResult.messageId).toBeDefined();
      } finally {
        await worker.close(true);
      }
    });
  });
});
