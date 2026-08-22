import { Worker, type Job } from 'bullmq';
import { defaultConnection, QUEUE_NAMES } from '../queues/queue.config.js';
import type { EmailJobData } from '../queues/email.queue.js';
import { emailService } from '../../config/email.js';
import { logger } from '../../config/logger.js';

export function createEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    QUEUE_NAMES.EMAIL,
    async (job: Job<EmailJobData>) => {
      logger.info(
        { jobId: job.id, to: job.data.to, subject: job.data.subject },
        'Processing email job',
      );

      const info = await emailService.sendDirect({
        to: job.data.to,
        from: job.data.from,
        subject: job.data.subject,
        text: job.data.text ?? (job.data.html ? undefined : `Subject: ${job.data.subject}`),
        html: job.data.html,
        userId: job.data.userId,
        provider: job.data.provider,
      });

      return {
        sent: true,
        recipient: job.data.to,
        messageId: info.messageId,
        timestamp: new Date().toISOString(),
      };
    },
    {
      connection: defaultConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job: Job<EmailJobData>) => {
    logger.info({ jobId: job.id, to: job.data.to }, 'Email job completed successfully');
  });

  worker.on('failed', (job: Job<EmailJobData> | undefined, err: Error) => {
    logger.error(
      { jobId: job?.id, to: job?.data.to, err: err.message },
      'Email job failed processing',
    );
  });

  worker.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Email worker internal error');
  });

  return worker;
}
