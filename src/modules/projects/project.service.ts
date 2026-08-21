import { ConflictError, NotFoundError } from '../../utils/errors.js';
import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import { projectRepository, type ProjectRepository } from './project.repository.js';
import { activityService, type ActivityService } from '../activity/activity.service.js';
import { cacheService, type CacheService, CACHE_KEYS, CACHE_TTL } from '../../utils/cache.js';
import { EntityType, ActivityAction } from '../../constants/activity.js';
import type {
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQuery,
} from './project.schema.js';
import type { ProjectResponse } from './project.types.js';

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository = projectRepository,
    private readonly activity: ActivityService = activityService,
    private readonly cache: CacheService = cacheService,
  ) {}

  private extractKeyFromName(name: string): string {
    const words = name
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    if (words.length >= 2) {
      return words
        .map((w) => w[0])
        .join('')
        .slice(0, 5);
    }

    return (name.replace(/[^A-Z0-9]/gi, '').slice(0, 4) || 'PRJ').toUpperCase();
  }

  private async generateUniqueKey(
    organizationId: string,
    name: string,
    customKey?: string,
  ): Promise<string> {
    if (customKey) {
      const existing = await this.repository.findByOrgAndKey(organizationId, customKey);
      if (existing) {
        throw new ConflictError(
          'Project with this key already exists in this organization',
          'PROJECT_KEY_ALREADY_EXISTS',
        );
      }
      return customKey;
    }

    const baseKey = this.extractKeyFromName(name);
    let candidateKey = baseKey;
    let counter = 1;

    while (await this.repository.findByOrgAndKey(organizationId, candidateKey)) {
      counter++;
      candidateKey = `${baseKey.slice(0, 4)}${counter}`;
    }

    return candidateKey;
  }

  async createProject(
    organizationId: string,
    userId: string,
    input: CreateProjectInput,
  ): Promise<ProjectResponse> {
    const key = await this.generateUniqueKey(organizationId, input.name, input.key);

    const project = await this.repository.createProject({
      organizationId,
      name: input.name.trim(),
      key,
      description: input.description?.trim() ?? null,
      status: input.status ?? 'ACTIVE',
      createdById: userId,
    });

    await this.cache.delByPattern(CACHE_KEYS.projectsListPattern(organizationId));

    await this.activity.logActivity({
      organizationId,
      userId,
      entityType: EntityType.PROJECT,
      entityId: project.id,
      action: ActivityAction.CREATED,
      metadata: { name: project.name, key: project.key, status: project.status },
    });

    return {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      key: project.key,
      description: project.description,
      status: project.status,
      createdById: project.createdById,
      createdBy: project.createdBy,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      _count: project._count,
    };
  }

  async getProjects(
    organizationId: string,
    query: ListProjectsQuery,
  ): Promise<PaginatedResponse<ProjectResponse>> {
    const cacheKey = CACHE_KEYS.projectsList(organizationId, query);

    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

        const { items, total } = await this.repository.findPaginatedProjects(organizationId, {
          status: query.status,
          search: query.search,
          skip,
          take,
        });

        const mappedProjects: ProjectResponse[] = items.map((p) => ({
          id: p.id,
          organizationId: p.organizationId,
          name: p.name,
          key: p.key,
          description: p.description,
          status: p.status,
          createdById: p.createdById,
          createdBy: p.createdBy,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          _count: p._count,
        }));

        return buildPaginatedResponse(mappedProjects, total, page, limit);
      },
      CACHE_TTL.PROJECTS_LIST,
    );
  }

  async getProjectById(organizationId: string, projectId: string): Promise<ProjectResponse> {
    return this.cache.getOrSet(
      CACHE_KEYS.project(organizationId, projectId),
      async () => {
        const project = await this.repository.findById(organizationId, projectId);

        if (!project) {
          throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
        }

        return {
          id: project.id,
          organizationId: project.organizationId,
          name: project.name,
          key: project.key,
          description: project.description,
          status: project.status,
          createdById: project.createdById,
          createdBy: project.createdBy,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          _count: project._count,
        };
      },
      CACHE_TTL.PROJECT,
    );
  }

  async updateProject(
    organizationId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectResponse> {
    const existing = await this.repository.findById(organizationId, projectId);

    if (!existing) {
      throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
    }

    if (input.key && input.key !== existing.key) {
      const keyConflict = await this.repository.findByOrgAndKey(organizationId, input.key);
      if (keyConflict && keyConflict.id !== projectId) {
        throw new ConflictError(
          'Project with this key already exists in this organization',
          'PROJECT_KEY_ALREADY_EXISTS',
        );
      }
    }

    const updated = await this.repository.updateProject(organizationId, projectId, {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.key ? { key: input.key } : {}),
      ...(input.description !== undefined
        ? { description: input.description ? input.description.trim() : null }
        : {}),
      ...(input.status ? { status: input.status } : {}),
    });

    await Promise.all([
      this.cache.del(CACHE_KEYS.project(organizationId, projectId)),
      this.cache.delByPattern(CACHE_KEYS.projectsListPattern(organizationId)),
    ]);

    await this.activity.logActivity({
      organizationId,
      userId: updated.createdById,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      action: ActivityAction.UPDATED,
      metadata: { name: updated.name, status: updated.status },
    });

    return {
      id: updated.id,
      organizationId: updated.organizationId,
      name: updated.name,
      key: updated.key,
      description: updated.description,
      status: updated.status,
      createdById: updated.createdById,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      _count: updated._count,
    };
  }

  async deleteProject(organizationId: string, projectId: string): Promise<void> {
    const existing = await this.repository.findById(organizationId, projectId);

    if (!existing) {
      throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
    }

    await this.repository.deleteProject(organizationId, projectId);

    await Promise.all([
      this.cache.del(CACHE_KEYS.project(organizationId, projectId)),
      this.cache.delByPattern(CACHE_KEYS.projectsListPattern(organizationId)),
    ]);

    await this.activity.logActivity({
      organizationId,
      userId: existing.createdById,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      action: ActivityAction.DELETED,
      metadata: { name: existing.name, key: existing.key },
    });
  }
}

export const projectService = new ProjectService();
