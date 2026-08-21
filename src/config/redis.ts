import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export interface RedisHealthStatus {
  status: 'healthy' | 'unhealthy';
  latencyMs?: number;
  error?: string;
}

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis {
  const isTest = env.NODE_ENV === 'test';

  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times) {
      if (isTest) return null;
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
  });

  client.on('connect', () => {
    logger.info('Connecting to Redis...');
  });

  client.on('ready', () => {
    logger.info('Connected to Redis successfully');
  });

  client.on('error', (err: Error) => {
    logger.error({ err }, 'Redis connection error');
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  client.on('reconnecting', (delay: number) => {
    logger.info({ delay }, 'Reconnecting to Redis...');
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

export async function connectRedis(): Promise<void> {
  try {
    if (redis.status === 'wait' || redis.status === 'close') {
      await redis.connect();
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to connect to Redis during startup. Will retry in background.');
  }
}

export async function disconnectRedis(): Promise<void> {
  try {
    if (redis.status === 'ready' || redis.status === 'connecting' || redis.status === 'connect') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from Redis');
    redis.disconnect();
  }
}

export async function checkRedisHealth(): Promise<RedisHealthStatus> {
  try {
    const start = Date.now();
    const pingPromise = redis.ping();
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Redis ping timeout'));
      }, 2000);
      timer.unref();
    });

    await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    return {
      status: 'healthy',
      latencyMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Redis error';
    return {
      status: 'unhealthy',
      error: message,
    };
  }
}
