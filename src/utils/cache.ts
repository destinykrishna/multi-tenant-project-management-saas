import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

export const CACHE_TTL = {
  ORGANIZATION: 300, // 5 minutes
  USER_ORGS: 120, // 2 minutes
  PROJECT: 300, // 5 minutes
  PROJECTS_LIST: 120, // 2 minutes
} as const;

export const CACHE_KEYS = {
  organization: (orgId: string) => `org:${orgId}`,
  userOrganizations: (userId: string) => `user:${userId}:orgs`,
  project: (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}`,
  projectsList: (orgId: string, query: Record<string, unknown>) =>
    `org:${orgId}:projects:${JSON.stringify(query)}`,
  projectsListPattern: (orgId: string) => `org:${orgId}:projects:*`,
} as const;

export class CacheService {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (error) {
      logger.warn({ error, key }, 'Redis get error - falling back to database');
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await redis.setex(key, ttlSeconds, serialized);
    } catch (error) {
      logger.warn({ error, key }, 'Redis set error - continuing without cache');
    }
  }

  async del(key: string | string[]): Promise<void> {
    try {
      const keys = Array.isArray(key) ? key : [key];
      if (keys.length === 0) return;
      await redis.del(...keys);
    } catch (error) {
      logger.warn({ error, key }, 'Redis del error - continuing');
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.warn({ error, pattern }, 'Redis scan/del error - continuing');
    }
  }

  async getOrSet<T>(key: string, fetcher: () => Promise<T>, ttlSeconds: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const result = await fetcher();
    await this.set(key, result, ttlSeconds);
    return result;
  }
}

export const cacheService = new CacheService();
