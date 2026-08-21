import { prisma } from '../../config/database.js';

export interface FindCommentsFilter {
  skip: number;
  take: number;
  sortBy: 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

export class CommentRepository {
  async validateTaskInOrg(organizationId: string, projectId: string, taskId: string) {
    return prisma.task.findFirst({
      where: {
        id: taskId,
        projectId,
        project: {
          organizationId,
        },
      },
    });
  }

  async createComment(taskId: string, userId: string, content: string) {
    return prisma.comment.create({
      data: {
        taskId,
        userId,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async findPaginatedComments(taskId: string, filter: FindCommentsFilter) {
    const where = { taskId };

    const [items, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: {
          [filter.sortBy]: filter.sortOrder,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      }),
      prisma.comment.count({ where }),
    ]);

    return { items, total };
  }

  async findCommentById(taskId: string, commentId: string) {
    return prisma.comment.findFirst({
      where: {
        id: commentId,
        taskId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async updateComment(taskId: string, commentId: string, content: string) {
    return prisma.comment.update({
      where: {
        id: commentId,
        taskId,
      },
      data: {
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async deleteComment(taskId: string, commentId: string) {
    return prisma.comment.delete({
      where: {
        id: commentId,
        taskId,
      },
    });
  }
}

export const commentRepository = new CommentRepository();
