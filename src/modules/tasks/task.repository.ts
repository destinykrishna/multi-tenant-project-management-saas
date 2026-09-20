import { prisma } from '../../config/database.js';
import type { TaskStatus, TaskPriority } from '../../constants/task.js';

export interface CreateTaskRepoData {
  projectId: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
  teamId?: string | null;
  dueDate?: Date | null;
  position: number;
  createdById: string;
}

export interface UpdateTaskRepoData {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  teamId?: string | null;
  dueDate?: Date | null;
  position?: number;
}

export interface FindTasksFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  teamId?: string;
  search?: string;
  sortBy: 'createdAt' | 'dueDate' | 'priority' | 'position' | 'title' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
  skip: number;
  take: number;
}

const taskIncludes = {
  project: {
    select: {
      id: true,
      organizationId: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
    },
  },
  assignee: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
    },
  },
  team: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
  _count: {
    select: {
      comments: true,
    },
  },
} as const;

export class TaskRepository {
  async findProjectInOrg(organizationId: string, projectId: string) {
    return prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId,
      },
    });
  }

  async findTaskInOrg(organizationId: string, taskId: string) {
    return prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          organizationId,
        },
      },
      include: taskIncludes,
    });
  }

  async isUserMemberOfOrg(organizationId: string, userId: string): Promise<boolean> {
    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });
    return !!member;
  }

  async isTeamInOrg(organizationId: string, teamId: string): Promise<boolean> {
    const team = await prisma.team.findFirst({
      where: {
        id: teamId,
        organizationId,
      },
    });
    return !!team;
  }

  async getMaxPosition(projectId: string, status: TaskStatus): Promise<number> {
    const task = await prisma.task.findFirst({
      where: {
        projectId,
        status,
      },
      orderBy: {
        position: 'desc',
      },
      select: {
        position: true,
      },
    });

    return task?.position ?? 0;
  }

  async createTask(data: CreateTaskRepoData) {
    return prisma.task.create({
      data: {
        projectId: data.projectId,
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        assigneeId: data.assigneeId,
        teamId: data.teamId,
        dueDate: data.dueDate,
        position: data.position,
        createdById: data.createdById,
      },
      include: taskIncludes,
    });
  }

  async findById(projectId: string, taskId: string) {
    return prisma.task.findFirst({
      where: {
        id: taskId,
        projectId,
      },
      include: taskIncludes,
    });
  }

  async findPaginatedTasks(projectId: string, filter: FindTasksFilter) {
    const where = {
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.teamId ? { teamId: filter.teamId } : {}),
      ...(filter.search
        ? {
            OR: [
              { title: { contains: filter.search, mode: 'insensitive' as const } },
              { description: { contains: filter.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: {
          [filter.sortBy]: filter.sortOrder,
        },
        include: taskIncludes,
      }),
      prisma.task.count({ where }),
    ]);

    return { items, total };
  }

  async updateTask(projectId: string, taskId: string, data: UpdateTaskRepoData) {
    return prisma.task.update({
      where: {
        id: taskId,
        projectId,
      },
      data,
      include: taskIncludes,
    });
  }

  async deleteTask(projectId: string, taskId: string) {
    return prisma.task.delete({
      where: {
        id: taskId,
        projectId,
      },
    });
  }
}

export const taskRepository = new TaskRepository();
