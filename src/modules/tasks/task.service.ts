import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import { VALID_STATUS_TRANSITIONS } from '../../constants/task.js';
import { taskRepository, type TaskRepository } from './task.repository.js';
import { activityService, type ActivityService } from '../activity/activity.service.js';
import {
  notificationService,
  type NotificationService,
} from '../notifications/notification.service.js';
import { NotificationType } from '../../constants/notification.js';
import { EntityType, ActivityAction } from '../../constants/activity.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from './task.schema.js';
import type { TaskResponse } from './task.types.js';

export class TaskService {
  constructor(
    private readonly repository: TaskRepository = taskRepository,
    private readonly activity: ActivityService = activityService,
    private readonly notification: NotificationService = notificationService,
  ) {}

  private async validateProjectInOrg(organizationId: string, projectId: string) {
    const project = await this.repository.findProjectInOrg(organizationId, projectId);
    if (!project) {
      throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
    }
    return project;
  }

  private async validateAssignee(organizationId: string, assigneeId?: string | null) {
    if (!assigneeId) return;

    const isMember = await this.repository.isUserMemberOfOrg(organizationId, assigneeId);
    if (!isMember) {
      throw new BadRequestError(
        'Assignee must be a member of the organization',
        'INVALID_ASSIGNEE',
      );
    }
  }

  async createTask(
    organizationId: string,
    projectId: string,
    userId: string,
    input: CreateTaskInput,
  ): Promise<TaskResponse> {
    await this.validateProjectInOrg(organizationId, projectId);
    await this.validateAssignee(organizationId, input.assigneeId);

    let position = input.position;
    if (position === undefined) {
      const maxPos = await this.repository.getMaxPosition(projectId, input.status);
      position = maxPos + 1000;
    }

    const task = await this.repository.createTask({
      projectId,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      position,
      createdById: userId,
    });

    await this.activity.logActivity({
      organizationId,
      userId,
      entityType: EntityType.TASK,
      entityId: task.id,
      action: ActivityAction.CREATED,
      metadata: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assigneeId,
      },
    });

    if (task.assigneeId && task.assigneeId !== userId) {
      await this.notification.queueNotification({
        userId: task.assigneeId,
        organizationId,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task Assigned',
        message: `You have been assigned to task "${task.title}"`,
        metadata: { taskId: task.id, projectId: task.projectId },
      });
    }

    return {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      assignee: task.assignee,
      createdById: task.createdById,
      createdBy: task.createdBy,
      dueDate: task.dueDate,
      position: task.position,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      _count: task._count,
    };
  }

  async getTasks(
    organizationId: string,
    projectId: string,
    query: ListTasksQuery,
  ): Promise<PaginatedResponse<TaskResponse>> {
    await this.validateProjectInOrg(organizationId, projectId);

    const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

    const { items, total } = await this.repository.findPaginatedTasks(projectId, {
      status: query.status,
      priority: query.priority,
      assigneeId: query.assigneeId,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      skip,
      take,
    });

    const mappedTasks: TaskResponse[] = items.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assigneeId: t.assigneeId,
      assignee: t.assignee,
      createdById: t.createdById,
      createdBy: t.createdBy,
      dueDate: t.dueDate,
      position: t.position,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      _count: t._count,
    }));

    return buildPaginatedResponse(mappedTasks, total, page, limit);
  }

  async getTaskById(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskResponse> {
    await this.validateProjectInOrg(organizationId, projectId);

    const task = await this.repository.findById(projectId, taskId);
    if (!task) {
      throw new NotFoundError('Task not found in this project', 'TASK_NOT_FOUND');
    }

    return {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      assignee: task.assignee,
      createdById: task.createdById,
      createdBy: task.createdBy,
      dueDate: task.dueDate,
      position: task.position,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      _count: task._count,
    };
  }

  async updateTask(
    organizationId: string,
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskResponse> {
    await this.validateProjectInOrg(organizationId, projectId);

    const existing = await this.repository.findById(projectId, taskId);
    if (!existing) {
      throw new NotFoundError('Task not found in this project', 'TASK_NOT_FOUND');
    }

    if (input.assigneeId !== undefined) {
      await this.validateAssignee(organizationId, input.assigneeId);
    }

    if (input.status && input.status !== existing.status) {
      const allowedNext = VALID_STATUS_TRANSITIONS[existing.status];
      if (!allowedNext.includes(input.status)) {
        throw new BadRequestError(
          `Invalid status transition from ${existing.status} to ${input.status}`,
          'INVALID_STATUS_TRANSITION',
        );
      }
    }

    const updated = await this.repository.updateTask(projectId, taskId, {
      ...(input.title ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description ? input.description.trim() : null }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    });

    let action: (typeof ActivityAction)[keyof typeof ActivityAction] = ActivityAction.UPDATED;
    let metadata: Prisma.InputJsonObject = { title: updated.title };

    if (input.status && input.status !== existing.status) {
      action = ActivityAction.TASK_STATUS_CHANGED;
      metadata = { previousStatus: existing.status, newStatus: input.status };
    } else if (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId) {
      action = ActivityAction.TASK_ASSIGNED;
      metadata = { previousAssigneeId: existing.assigneeId, newAssigneeId: input.assigneeId };
    }

    await this.activity.logActivity({
      organizationId,
      userId: updated.createdById,
      entityType: EntityType.TASK,
      entityId: taskId,
      action,
      metadata,
    });

    if (
      input.assigneeId &&
      input.assigneeId !== existing.assigneeId &&
      input.assigneeId !== updated.createdById
    ) {
      await this.notification.queueNotification({
        userId: input.assigneeId,
        organizationId,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task Assigned',
        message: `You have been assigned to task "${updated.title}"`,
        metadata: { taskId: updated.id, projectId: updated.projectId },
      });
    }

    if (
      input.status &&
      input.status !== existing.status &&
      updated.assigneeId &&
      updated.assigneeId !== updated.createdById
    ) {
      await this.notification.queueNotification({
        userId: updated.assigneeId,
        organizationId,
        type: NotificationType.TASK_STATUS_CHANGED,
        title: 'Task Status Updated',
        message: `Task "${updated.title}" status changed to ${input.status}`,
        metadata: {
          taskId: updated.id,
          previousStatus: existing.status,
          newStatus: input.status,
        },
      });
    }

    return {
      id: updated.id,
      projectId: updated.projectId,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      priority: updated.priority,
      assigneeId: updated.assigneeId,
      assignee: updated.assignee,
      createdById: updated.createdById,
      createdBy: updated.createdBy,
      dueDate: updated.dueDate,
      position: updated.position,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      _count: updated._count,
    };
  }

  async deleteTask(organizationId: string, projectId: string, taskId: string): Promise<void> {
    await this.validateProjectInOrg(organizationId, projectId);

    const existing = await this.repository.findById(projectId, taskId);
    if (!existing) {
      throw new NotFoundError('Task not found in this project', 'TASK_NOT_FOUND');
    }

    await this.repository.deleteTask(projectId, taskId);

    await this.activity.logActivity({
      organizationId,
      userId: existing.createdById,
      entityType: EntityType.TASK,
      entityId: taskId,
      action: ActivityAction.DELETED,
      metadata: { title: existing.title, projectId },
    });
  }
}

export const taskService = new TaskService();
