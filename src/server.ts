import 'dotenv/config';
import type { Server } from 'node:http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import {
  startAllWorkers,
  shouldRunInlineWorkers,
  type RunningWorkers,
} from './jobs/workers/index.js';
import { initSocketServer, closeSocketServer } from './config/socket.js';

let server: Server | undefined;
let workers: RunningWorkers | undefined;

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, `Received ${signal}. Starting graceful shutdown...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExitTimer.unref();

  try {
    if (workers) {
      await workers.stop();
      logger.info('Background workers stopped');
    }

    await closeSocketServer();
    logger.info('Socket.IO server closed');

    if (server) {
      const activeServer = server;
      await new Promise<void>((resolve, reject) => {
        activeServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      logger.info('HTTP server closed');
    }

    await disconnectRedis();
    await disconnectDatabase();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();

    if (shouldRunInlineWorkers()) {
      workers = startAllWorkers();
      logger.info('Inline BullMQ workers initialized inside API server process');
    } else {
      logger.info('BullMQ workers disabled in API process (delegated to dedicated worker service)');
    }

    server = app.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, environment: env.NODE_ENV },
        `Server started on port ${env.PORT}`,
      );
    });

    initSocketServer(server);
  } catch (error) {
    logger.fatal({ error }, 'Failed to start application server');
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  void gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (error: Error) => {
  logger.fatal({ error }, 'Uncaught exception');
  void gracefulShutdown('uncaughtException');
});

void bootstrap();
