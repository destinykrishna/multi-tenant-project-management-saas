 import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { redis } from '../../src/config/redis.js';
import { cacheService, CACHE_KEYS } from '../../src/utils/cache.js';
import { organizationService } from '../../src/modules/organizations/organization.service.js';
import { projectService } from '../../src/modules/projects/project.service.js';

describe('Redis Caching Integration Tests', () => {
  let user1: { id: string; email: string };
  let user2: { id: string; email: string };
  let org1Id: string;
  let org2Id: string;
  let proj1Id: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const u1 = await prisma.user.create({
      data: {
        name: 'Cache User 1',
        email: `cache.user1.${Date.now()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });
    const u2 = await prisma.user.create({
      data: {
        name: 'Cache User 2',
        email: `cache.user2.${Date.now()}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });

    createdUserIds.push(u1.id, u2.id);
    user1 = { id: u1.id, email: u1.email };
    user2 = { id: u2.id, email: u2.email };

    const org1 = await organizationService.createOrganization(user1.id, {
      name: 'Cache Org 1',
      slug: `cache-org-1-${randomUUID()}`,
    });
    org1Id = org1.id;

    const org2 = await organizationService.createOrganization(user2.id, {
      name: 'Cache Org 2',
      slug: `cache-org-2-${randomUUID()}`,
    });
    org2Id = org2.id;

    const proj1 = await projectService.createProject(org1Id, user1.id, {
      name: 'Cache Project 1',
      key: 'CPRJ1',
    });
    proj1Id = proj1.id;
  });

  afterAll(async () => {
    if (org1Id || org2Id) {
      await prisma.activityLog.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.task.deleteMany({
        where: { project: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } } },
      });
      await prisma.project.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [org1Id, org2Id].filter(Boolean) } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    await disconnectDatabase();
  });

  it('should demonstrate cache miss and subsequent cache hit for organization retrieval', async () => {
    const cacheKey = CACHE_KEYS.organization(org1Id);
    await cacheService.del(cacheKey);

    // Initial read - cache miss
    const cachedBefore = await cacheService.get(cacheKey);
    expect(cachedBefore).toBeNull();

    // Fetch from DB and warm cache
    const org = await organizationService.getOrganizationById(org1Id);
    expect(org.id).toBe(org1Id);

    // Subsequent read - cache hit
    const cachedAfter = await cacheService.get(cacheKey);
    expect(cachedAfter).not.toBeNull();
    expect((cachedAfter as typeof org).id).toBe(org1Id);
  });

  it('should demonstrate user organizations caching and invalidation', async () => {
    const userForCache = await prisma.user.create({
      data: {
        name: 'Cache Invalidation User',
        email: `cache.inval.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`,
        passwordHash: 'dummy-hash',
      },
    });
    createdUserIds.push(userForCache.id);

    const userOrgsKey = CACHE_KEYS.userOrganizations(userForCache.id);
    await cacheService.del(userOrgsKey);

    // Initial fetch caches user's organizations (empty array)
    const userOrgs = await organizationService.getUserOrganizations(userForCache.id);
    expect(userOrgs.length).toBe(0);

    const cachedUserOrgs = await cacheService.get<typeof userOrgs>(userOrgsKey);
    expect(cachedUserOrgs).not.toBeNull();
    expect(cachedUserOrgs?.length).toBe(0);

    // Creating an organization invalidates user's cached organizations
    const newOrg = await organizationService.createOrganization(userForCache.id, {
      name: 'User Invalidation Org',
      slug: `u-inval-org-${randomUUID()}`,
    });

    const cachedAfterNewOrg = await cacheService.get(userOrgsKey);
    expect(cachedAfterNewOrg).toBeNull();

    // Fresh fetch reflects the newly created organization
    const updatedOrgs = await organizationService.getUserOrganizations(userForCache.id);
    expect(updatedOrgs.length).toBe(1);
    expect(updatedOrgs[0].id).toBe(newOrg.id);

    // Clean up created org
    await organizationService.deleteOrganization(newOrg.id);
  });

  it('should demonstrate cache invalidation upon organization update', async () => {
    const cacheKey = CACHE_KEYS.organization(org1Id);

    // Warm cache
    await organizationService.getOrganizationById(org1Id);
    expect(await cacheService.get(cacheKey)).not.toBeNull();

    // Update organization
    await organizationService.updateOrganization(org1Id, { name: 'Cache Org 1 Renamed' });

    // Cache should be invalidated
    const cachedAfterUpdate = await cacheService.get(cacheKey);
    expect(cachedAfterUpdate).toBeNull();

    // Fresh fetch returns updated data and warms cache again
    const refreshed = await organizationService.getOrganizationById(org1Id);
    expect(refreshed.name).toBe('Cache Org 1 Renamed');
  });

  it('should demonstrate cache miss, hit, and invalidation for project queries', async () => {
    const projectKey = CACHE_KEYS.project(org1Id, proj1Id);
    await cacheService.del(projectKey);

    // Cache miss
    expect(await cacheService.get(projectKey)).toBeNull();

    const project = await projectService.getProjectById(org1Id, proj1Id);
    expect(project.id).toBe(proj1Id);

    // Cache hit
    const cachedProj = await cacheService.get<{ id: string; name: string }>(projectKey);
    expect(cachedProj?.id).toBe(proj1Id);

    // Invalidate on update
    await projectService.updateProject(org1Id, proj1Id, { name: 'Updated Project 1' });
    expect(await cacheService.get(projectKey)).toBeNull();
  });

  it('should cache project list queries and invalidate with pattern matching', async () => {
    const query = { page: 1, limit: 10 };
    const listCacheKey = CACHE_KEYS.projectsList(org1Id, query);

    await cacheService.delByPattern(CACHE_KEYS.projectsListPattern(org1Id));

    // Fetch projects to populate list cache
    const list1 = await projectService.getProjects(org1Id, query);
    expect(list1.items.length).toBeGreaterThanOrEqual(1);

    const cachedList = await cacheService.get<typeof list1>(listCacheKey);
    expect(cachedList).not.toBeNull();
    expect(cachedList?.items.length).toBe(list1.items.length);

    // Create a new project -> invalidates all project list caches for org1
    const p2 = await projectService.createProject(org1Id, user1.id, {
      name: 'Temp Project 2',
      key: 'TPRJ2',
    });

    const cachedListAfterCreate = await cacheService.get(listCacheKey);
    expect(cachedListAfterCreate).toBeNull();

    // Clean up
    await projectService.deleteProject(org1Id, p2.id);
  });

  it('should maintain strict tenant isolation in cache keyspaces', async () => {
    const org1Key = CACHE_KEYS.organization(org1Id);
    const org2Key = CACHE_KEYS.organization(org2Id);

    await organizationService.getOrganizationById(org1Id);
    await organizationService.getOrganizationById(org2Id);

    const org1Cached = await cacheService.get<{ id: string }>(org1Key);
    const org2Cached = await cacheService.get<{ id: string }>(org2Key);

    expect(org1Cached?.id).toBe(org1Id);
    expect(org2Cached?.id).toBe(org2Id);
    expect(org1Cached?.id).not.toBe(org2Cached?.id);
  });

  it('should gracefully fall back to database fetcher if Redis get/set encounters errors', async () => {
    // Spy and simulate Redis error
    const getSpy = jest.spyOn(redis, 'get').mockRejectedValueOnce(new Error('Redis connection down'));

    let fetcherCalled = false;
    const result = await cacheService.getOrSet(
      'faulty:key',
      async () => {
        fetcherCalled = true;
        return { success: true, fromDb: true };
      },
      60,
    );

    expect(fetcherCalled).toBe(true);
    expect(result).toEqual({ success: true, fromDb: true });

    getSpy.mockRestore();
  });
});
