import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import { OrganizationRole } from '../../constants/roles.js';
import { commentRepository, type CommentRepository } from './comment.repository.js';
import { activityService, type ActivityService } from '../activity/activity.service.js';
import {
  notificationService,
  type NotificationService,
} from '../notifications/notification.service.js';
import { EntityType, ActivityAction } from '../../constants/activity.js';
import { NotificationType } from '../../constants/notification.js';
import type {
  CreateCommentInput,
  UpdateCommentInput,
  ListCommentsQuery,
} from './comment.schema.js';
import type { CommentResponse } from './comment.types.js';

export class CommentService {
  constructor(
    private readonly repository: CommentRepository = commentRepository,
    private readonly activity: ActivityService = activityService,
    private readonly notifications: NotificationService = notificationService,
  ) {}

  private async validateTaskInOrg(organizationId: string, projectId: string, taskId: string) {
    const task = await this.repository.validateTaskInOrg(organizationId, projectId, taskId);
    if (!task) {
      throw new NotFoundError('Task not found in this organization and project', 'TASK_NOT_FOUND');
    }
    return task;
  }

  async createComment(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    input: CreateCommentInput,
  ): Promise<CommentResponse> {
    const task = await this.validateTaskInOrg(organizationId, projectId, taskId);

    const comment = await this.repository.createComment(taskId, userId, input.content.trim());

    await this.activity.logActivity({
      organizationId,
      userId,
      entityType: EntityType.COMMENT,
      entityId: comment.id,
      action: ActivityAction.CREATED,
      metadata: { taskId, projectId },
    });

    // Notify task assignee if assignee is not the comment author
    if (task.assigneeId && task.assigneeId !== userId) {
      await this.notifications.queueNotification({
        userId: task.assigneeId,
        organizationId,
        type: NotificationType.GENERAL,
        title: 'New comment on your task',
        message: `A new comment was posted on task "${task.title}"`,
        metadata: { taskId, projectId, commentId: comment.id },
      });
    }

    return {
      id: comment.id,
      taskId: comment.taskId,
      userId: comment.userId,
      content: comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      user: comment.user,
    };
  }

  async getComments(
    organizationId: string,
    projectId: string,
    taskId: string,
    query: ListCommentsQuery,
  ): Promise<PaginatedResponse<CommentResponse>> {
    await this.validateTaskInOrg(organizationId, projectId, taskId);

    const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

    const { items, total } = await this.repository.findPaginatedComments(taskId, {
      skip,
      take,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    const mappedComments: CommentResponse[] = items.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      userId: c.userId,
      content: c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      user: c.user,
    }));

    return buildPaginatedResponse(mappedComments, total, page, limit);
  }

  async updateComment(
    organizationId: string,
    projectId: string,
    taskId: string,
    commentId: string,
    userId: string,
    input: UpdateCommentInput,
  ): Promise<CommentResponse> {
    await this.validateTaskInOrg(organizationId, projectId, taskId);

    const comment = await this.repository.findCommentById(taskId, commentId);
    if (!comment) {
      throw new NotFoundError('Comment not found in this task', 'COMMENT_NOT_FOUND');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenError('You can only edit your own comments', 'INSUFFICIENT_PERMISSIONS');
    }

    const updated = await this.repository.updateComment(taskId, commentId, input.content.trim());

    await this.activity.logActivity({
      organizationId,
      userId,
      entityType: EntityType.COMMENT,
      entityId: commentId,
      action: ActivityAction.UPDATED,
      metadata: { taskId, projectId },
    });

    return {
      id: updated.id,
      taskId: updated.taskId,
      userId: updated.userId,
      content: updated.content,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      user: updated.user,
    };
  }

  async deleteComment(
    organizationId: string,
    projectId: string,
    taskId: string,
    commentId: string,
    userId: string,
    role: string,
  ): Promise<void> {
    await this.validateTaskInOrg(organizationId, projectId, taskId);

    const comment = await this.repository.findCommentById(taskId, commentId);
    if (!comment) {
      throw new NotFoundError('Comment not found in this task', 'COMMENT_NOT_FOUND');
    }

    const isAuthor = comment.userId === userId;
    const isModerator = role === OrganizationRole.OWNER || role === OrganizationRole.ADMIN;

    if (!isAuthor && !isModerator) {
      throw new ForbiddenError(
        'Insufficient permissions to delete this comment',
        'INSUFFICIENT_PERMISSIONS',
      );
    }

    await this.repository.deleteComment(taskId, commentId);

    await this.activity.logActivity({
      organizationId,
      userId,
      entityType: EntityType.COMMENT,
      entityId: commentId,
      action: ActivityAction.DELETED,
      metadata: { taskId, projectId, deletedByModerator: !isAuthor },
    });
  }
}

export const commentService = new CommentService();
