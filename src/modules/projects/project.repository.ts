import { prisma } from '../../config/database.js';
import type { ProjectStatus } from './project.types.js';

export interface CreateProjectRepoData {
  organizationId: string;
  name: string;
  key: string;
  description?: string | null;
  status?: ProjectStatus;
  createdById: string;
}

export interface UpdateProjectRepoData {
  name?: string;
  key?: string;
  description?: string | null;
  status?: ProjectStatus;
}

export interface FindProjectsFilter {
  status?: ProjectStatus;
  search?: string;
  skip: number;
  take: number;
}

export class ProjectRepository {
  async createProject(data: CreateProjectRepoData) {
    return prisma.project.create({
      data: {
        organizationId: data.organizationId,
        name: data.name,
        key: data.key,
        description: data.description,
        status: data.status,
        createdById: data.createdById,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    });
  }

  async findByOrgAndKey(organizationId: string, key: string) {
    return prisma.project.findUnique({
      where: {
        organizationId_key: {
          organizationId,
          key,
        },
      },
    });
  }

  async findById(organizationId: string, projectId: string) {
    return prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    });
  }

  async findPaginatedProjects(organizationId: string, filter: FindProjectsFilter) {
    const where = {
      organizationId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' as const } },
              { key: { contains: filter.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
          _count: {
            select: {
              tasks: true,
            },
          },
        },
      }),
      prisma.project.count({ where }),
    ]);

    return { items, total };
  }

  async updateProject(organizationId: string, projectId: string, data: UpdateProjectRepoData) {
    return prisma.project.update({
      where: {
        id: projectId,
        organizationId,
      },
      data,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    });
  }

  async deleteProject(organizationId: string, projectId: string) {
    return prisma.project.delete({
      where: {
        id: projectId,
        organizationId,
      },
    });
  }
}

export const projectRepository = new ProjectRepository();
