import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { logger } from './logger.js';
import { env } from './env.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

function createPrismaClient(): { client: PrismaClient; pool: Pool } {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error');
  });

  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
  });

  const client = new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ],
  });

  if (env.NODE_ENV === 'development') {
    client.$on('query', (e) => {
      logger.debug({ duration: e.duration, query: e.query }, 'Prisma query');
    });
  }

  client.$on('warn', (e) => {
    logger.warn(e, 'Prisma warning');
  });

  client.$on('error', (e) => {
    logger.error(e, 'Prisma error');
  });

  return { client, pool };
}

const instances =
  globalForPrisma.prisma && globalForPrisma.pool
    ? { client: globalForPrisma.prisma, pool: globalForPrisma.pool }
    : createPrismaClient();

// Singleton PrismaClient instance
export const prisma = instances.client;
export const dbPool = instances.pool;

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pool = dbPool;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Connected to PostgreSQL database successfully');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database connection closed');
}

/**
 * Executes a database operation within a strict tenant isolation context.
 * Sets the PostgreSQL session variable `app.current_org_id`, activating
 * native database Row-Level Security (RLS) enforcement.
 */
export async function withTenantContext<T>(
  organizationId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    return fn(prisma);
  }

  return prisma.$transaction(async (tx) => {
    // Sanitize organizationId for safe session variable setting
    const sanitizedOrgId = organizationId.replace(/[^a-zA-Z0-9_-]/g, '');
    await tx.$executeRawUnsafe(`SET LOCAL app.current_org_id = '${sanitizedOrgId}';`);
    return fn(tx as unknown as PrismaClient);
  });
}

