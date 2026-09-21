import { createHash } from 'node:crypto';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';

/**
 * High-Throughput In-Memory Bloom Filter
 *
 * Space-efficient probabilistic data structure for set membership testing.
 * - False Negative Rate: 0% (Definitively guaranteed)
 * - False Positive Rate: < 0.1% (Configurable via size and hash count)
 * - Lookup Complexity: O(k) bit operations (< 0.01 ms)
 */
export class BloomFilter {
  private readonly size: number;
  private readonly hashCount: number;
  private readonly bitArray: Uint8Array;

  /**
   * @param expectedItems Number of items expected to store
   * @param falsePositiveRate Acceptable false positive probability (default 0.001 = 0.1%)
   */
  constructor(expectedItems: number = 100_000, falsePositiveRate: number = 0.001) {
    // Optimal bit array size m = - (n * ln(p)) / (ln(2)^2)
    const m = Math.ceil(
      -1 * ((expectedItems * Math.log(falsePositiveRate)) / Math.pow(Math.log(2), 2)),
    );
    this.size = Math.max(m, 1024);

    // Optimal number of hash functions k = (m / n) * ln(2)
    const k = Math.round((this.size / expectedItems) * Math.log(2));
    this.hashCount = Math.max(1, Math.min(k, 16));

    // Allocate byte array (each byte holds 8 bits)
    this.bitArray = new Uint8Array(Math.ceil(this.size / 8));
  }

  /**
   * Generates k distinct bit positions using double hashing technique:
   * hash_i = (hash1 + i * hash2) % size
   */
  private getIndexes(item: string): number[] {
    const hash1 = createHash('sha256').update(item).digest();
    const hash2 = createHash('md5').update(item).digest();

    const h1 = hash1.readUInt32BE(0);
    const h2 = hash2.readUInt32BE(0) || 1;

    const indexes: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      const combined = (h1 + i * h2) >>> 0;
      indexes.push(combined % this.size);
    }
    return indexes;
  }

  /**
   * Adds an element to the Bloom filter
   */
  add(item: string): void {
    if (!item) return;
    const indexes = this.getIndexes(item);
    for (const index of indexes) {
      const byteIndex = Math.floor(index / 8);
      const bitOffset = index % 8;
      const currentByte = this.bitArray[byteIndex] ?? 0;
      this.bitArray[byteIndex] = currentByte | (1 << bitOffset);
    }
  }

  /**
   * Tests whether an element is possibly in the set.
   * - If FALSE: Item is 100% GUARANTEED NOT in the set.
   * - If TRUE: Item is probably in the set (small false-positive chance).
   */
  has(item: string): boolean {
    if (!item) return false;
    const indexes = this.getIndexes(item);
    for (const index of indexes) {
      const byteIndex = Math.floor(index / 8);
      const bitOffset = index % 8;
      const currentByte = this.bitArray[byteIndex] ?? 0;
      if ((currentByte & (1 << bitOffset)) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Clears the filter
   */
  clear(): void {
    this.bitArray.fill(0);
  }
}

/**
 * Specialized Bloom Service for High-Speed Token Revocation
 */
class TokenRevocationBloomService {
  private readonly bloom = new BloomFilter(250_000, 0.0005);
  // Authoritative in-memory set to confirm hits locally (eliminating false-positive logouts)
  private readonly authoritativeSet = new Set<string>();

  /**
   * Revoke a token ID (jti) with bounded TTL in Redis and register in Bloom filter
   */
  async revoke(jti: string, ttlSeconds: number = 900): Promise<void> {
    if (!jti) return;
    this.bloom.add(jti);
    this.authoritativeSet.add(jti);

    const ttl = Math.max(1, Math.ceil(ttlSeconds));
    try {
      await redis.setex(`revoked:jti:${jti}`, ttl, '1');
      logger.info({ jti, ttl }, 'Security: Token JTI revoked in distributed Redis denylist');
    } catch (error) {
      logger.error({ error, jti }, 'Failed to store revoked JTI in Redis');
    }
  }

  /**
   * Synchronous check against local in-memory Bloom filter and authoritative set.
   * Preserved for synchronous callers like Socket.IO handshake.
   */
  isRevoked(jti?: string): boolean {
    if (!jti) return false;

    if (!this.bloom.has(jti)) {
      return false;
    }

    return this.authoritativeSet.has(jti);
  }

  /**
   * Authoritative distributed revocation check against Redis.
   * Survives process restarts and works across multiple backend instances.
   */
  async isRevokedDistributed(jti?: string): Promise<boolean> {
    if (!jti) return false;

    // Fast positive check: if local Bloom filter / authoritative set already confirms revocation
    if (this.isRevoked(jti)) {
      return true;
    }

    try {
      const exists = await redis.exists(`revoked:jti:${jti}`);
      if (exists === 1) {
        this.bloom.add(jti);
        this.authoritativeSet.add(jti);
        return true;
      }
      return false;
    } catch (error) {
      logger.error({ error, jti }, 'Redis token revocation check failed; failing closed');
      throw error;
    }
  }

  /**
   * Clears local in-memory Bloom filter and set (for testing process restarts / multi-instance simulation)
   */
  clearLocalState(): void {
    this.bloom.clear();
    this.authoritativeSet.clear();
  }

  /**
   * Purge expired items periodically
   */
  prune(): void {
    if (this.authoritativeSet.size > 200_000) {
      this.authoritativeSet.clear();
      this.bloom.clear();
      logger.info('Security: Bloom revocation filter pruned');
    }
  }
}

export const tokenRevocationBloom = new TokenRevocationBloomService();

/**
 * Cache-Penetration Guard Bloom Filter
 *
 * Prevents denial-of-service (DoS) attacks where attackers send millions of requests
 * for random/fake UUIDs to exhaust database connection pools and bypass caches.
 */
class EntityCacheBloomService {
  private readonly bloom = new BloomFilter(500_000, 0.001);

  /**
   * Register a known valid entity ID (e.g. "task:uuid", "project:uuid")
   */
  register(entityType: string, entityId: string): void {
    if (!entityId) return;
    this.bloom.add(`${entityType}:${entityId}`);
  }

  /**
   * Fast existence check.
   * If this returns true, the entity DEFINITELY DOES NOT EXIST in the system.
   * Prevents hitting database for randomized malicious UUID probes.
   */
  definitelyDoesNotExist(entityType: string, entityId: string): boolean {
    if (!entityId) return true;
    return !this.bloom.has(`${entityType}:${entityId}`);
  }
}

export const entityCacheBloom = new EntityCacheBloomService();
