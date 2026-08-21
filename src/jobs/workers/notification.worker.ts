import { Worker, type Job } from 'bullmq';
import { defaultConnection, QUEUE_NAMES } from '../queues/queue.config.js';
import type { NotificationJobData } from '../queues/notification.queue.js';
import { notificationRepository } from '../../modules/notifications/notification.repository.js';
import type { NotificationType } from '../../constants/notification.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { logger } from '../../config/logger.js';

export function createNotificationWorker(): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    QUEUE_NAMES.NOTIFICATION,
    async (job: Job<NotificationJobData>) => {
      logger.info(
        {
          jobId: job.id,
          userId: job.data.userId,
          organizationId: job.data.organizationId,
          type: job.data.type,
        },
        'Processing notification job',
      );

      try {
        const notification = await notificationRepository.create({
          userId: job.data.userId,
          organizationId: job.data.organizationId || null,
          type: job.data.type as NotificationType,
          title: job.data.title,
          message: job.data.message,
          metadata: job.data.metadata as Prisma.InputJsonValue,
        });

        return {
          delivered: true,
          notificationId: notification.id,
          userId: job.data.userId,
          timestamp: new Date().toISOString(),
        };
      } catch (err: unknown) {
        // If recipient user or org no longer exists, complete job gracefully
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'P2003'
        ) {
          logger.warn(
            { userId: job.data.userId, orgId: job.data.organizationId },
            'Recipient user or organization does not exist, skipping notification',
          );
          return { delivered: false, skipped: true };
        }
        throw err;
      }
    },
    {
      connection: defaultConnection,
      concurrency: 10,
    },
  );

  worker.on('completed', (job: Job<NotificationJobData>) => {
    logger.info({ jobId: job.id, userId: job.data.userId }, 'Notification job completed');
  });

  worker.on('failed', (job: Job<NotificationJobData> | undefined, err: Error) => {
    logger.error(
      { jobId: job?.id, userId: job?.data.userId, err: err.message },
      'Notification job failed processing',
    );
  });

  worker.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Notification worker internal error');
  });

  return worker;
}
