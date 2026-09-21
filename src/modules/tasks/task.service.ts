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
import { emailService, type EmailService } from '../../config/email.js';
import { emitToProject, emitToTask } from '../../config/socket.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from './task.schema.js';
import type { TaskResponse } from './task.types.js';

export class TaskService {
  constructor(
    private readonly repository: TaskRepository = taskRepository,
    private readonly activity: ActivityService = activityService,
    private readonly notification: NotificationService = notificationService,
    private readonly email: EmailService = emailService,
  ) {}

  private async validateProjectInOrg(organizationId: string, projectId: string) {
    const project = await this.repository.findProjectInOrg(organizationId, projectId);
    if (!project) {
      throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
    }
    return project;
  }

  private async validateAssignees(organizationId: string, assigneeUserIds?: string[]) {
    if (!assigneeUserIds || assigneeUserIds.length === 0) {
      return { uniqueIds: [], memberUsers: [] };
    }

    const uniqueIds = Array.from(new Set(assigneeUserIds));
    const memberUsers = await this.repository.getOrgMemberUsers(organizationId, uniqueIds);

    if (memberUsers.length !== uniqueIds.length) {
      throw new BadRequestError(
        'One or more assignees are not members of the organization',
        'INVALID_ASSIGNEE',
      );
    }

    return { uniqueIds, memberUsers };
  }

  private async validateTeam(organizationId: string, teamId?: string | null) {
    if (!teamId) return;

    const isTeam = await this.repository.isTeamInOrg(organizationId, teamId);
    if (!isTeam) {
      throw new BadRequestError('Team must belong to the organization', 'INVALID_TEAM');
    }
  }

  async createTask(
    organizationId: string,
    projectId: string,
    userId: string,
    input: CreateTaskInput,
  ): Promise<TaskResponse> {
    await this.validateProjectInOrg(organizationId, projectId);

    let rawAssigneeIds: string[] | undefined = undefined;
    if (input.assigneeUserIds !== undefined) {
      rawAssigneeIds = input.assigneeUserIds;
    } else if (input.assigneeId !== undefined) {
      rawAssigneeIds = input.assigneeId ? [input.assigneeId] : [];
    }

    const { uniqueIds, memberUsers } = await this.validateAssignees(organizationId, rawAssigneeIds);
    await this.validateTeam(organizationId, input.teamId);

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
      assigneeUserIds: uniqueIds,
      teamId: input.teamId ?? null,
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
        assigneeUserIds: uniqueIds,
        teamId: task.teamId,
      },
    });

    // Notify newly assigned members (in-app and via email)
    for (const assigneeUserId of uniqueIds) {
      if (assigneeUserId !== userId) {
        await this.notification.queueNotification({
          userId: assigneeUserId,
          organizationId,
          type: NotificationType.TASK_ASSIGNED,
          title: 'Task Assigned',
          message: `You have been assigned to task "${task.title}"`,
          metadata: { taskId: task.id, projectId: task.projectId },
        });
      }

      const assignedUser = memberUsers.find((u) => u.id === assigneeUserId);
      if (assignedUser?.email) {
        await this.email.queueEmail({
          to: assignedUser.email,
          subject: `You have been assigned to task: ${task.title}`,
          text: `Hello ${assignedUser.name},\n\nYou have been assigned to task "${task.title}".\n\nLog in to your workspace to view task details.`,
          html: `<p>Hello ${assignedUser.name},</p><p>You have been assigned to task <strong>"${task.title}"</strong>.</p><p>Log in to your workspace to view task details.</p>`,
          userId: assignedUser.id,
        });
      }
    }

    const result: TaskResponse = {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assignees[0]?.userId ?? task.assigneeId ?? null,
      assignee: task.assignees[0]?.user ?? task.assignee ?? null,
      assignees: task.assignees.map((a) => ({
        id: a.id,
        userId: a.userId,
        user: a.user,
      })),
      teamId: task.teamId,
      team: task.team,
      createdById: task.createdById,
      createdBy: task.createdBy,
      dueDate: task.dueDate,
      position: task.position,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      _count: task._count,
    };

    emitToProject(organizationId, projectId, 'task.created', result);
    emitToTask(organizationId, task.id, 'task.created', result);

    return result;
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
      teamId: query.teamId,
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
      assigneeId: t.assignees[0]?.userId ?? t.assigneeId ?? null,
      assignee: t.assignees[0]?.user ?? t.assignee ?? null,
      assignees: t.assignees.map((a) => ({
        id: a.id,
        userId: a.userId,
        user: a.user,
      })),
      teamId: t.teamId,
      team: t.team,
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
      assigneeId: task.assignees[0]?.userId ?? task.assigneeId ?? null,
      assignee: task.assignees[0]?.user ?? task.assignee ?? null,
      assignees: task.assignees.map((a) => ({
        id: a.id,
        userId: a.userId,
        user: a.user,
      })),
      teamId: task.teamId,
      team: task.team,
      createdById: task.createdById,
      createdBy: task.createdBy,
      dueDate: task.dueDate,
      position: task.position,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      _count: task._count,
    };
  }

  async getTaskInOrg(organizationId: string, taskId: string) {
    const task = await this.repository.findTaskInOrg(organizationId, taskId);
    if (!task) {
      throw new NotFoundError('Task not found in this organization', 'TASK_NOT_FOUND');
    }
    return task;
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

    const previousAssigneeIds = existing.assignees.map((a) => a.userId);
    let resolvedAssigneeUserIds: string[] | undefined = undefined;
    let memberUsersToEmail: Array<{ id: string; name: string; email: string }> = [];

    if (input.assigneeUserIds !== undefined) {
      const validation = await this.validateAssignees(organizationId, input.assigneeUserIds);
      resolvedAssigneeUserIds = validation.uniqueIds;
      memberUsersToEmail = validation.memberUsers;
    } else if (input.assigneeId !== undefined) {
      const ids = input.assigneeId ? [input.assigneeId] : [];
      const validation = await this.validateAssignees(organizationId, ids);
      resolvedAssigneeUserIds = validation.uniqueIds;
      memberUsersToEmail = validation.memberUsers;
    }

    if (input.teamId !== undefined) {
      await this.validateTeam(organizationId, input.teamId);
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

    // Determine newly added members (only newly added members should receive assignment emails)
    let newlyAddedUserIds: string[] = [];
    if (resolvedAssigneeUserIds !== undefined) {
      newlyAddedUserIds = resolvedAssigneeUserIds.filter((id) => !previousAssigneeIds.includes(id));
    }

    const updated = await this.repository.updateTask(projectId, taskId, {
      ...(input.title ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description ? input.description.trim() : null }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(resolvedAssigneeUserIds !== undefined
        ? { assigneeUserIds: resolvedAssigneeUserIds }
        : {}),
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    });

    let action: (typeof ActivityAction)[keyof typeof ActivityAction] = ActivityAction.UPDATED;
    let metadata: Prisma.InputJsonObject = { title: updated.title };

    if (input.status && input.status !== existing.status) {
      action = ActivityAction.TASK_STATUS_CHANGED;
      metadata = { previousStatus: existing.status, newStatus: input.status };
    } else if (
      (resolvedAssigneeUserIds !== undefined &&
        (resolvedAssigneeUserIds.length !== previousAssigneeIds.length ||
          newlyAddedUserIds.length > 0)) ||
      (input.teamId !== undefined && input.teamId !== existing.teamId)
    ) {
      action = ActivityAction.TASK_ASSIGNED;
      metadata = {
        previousAssigneeIds,
        newAssigneeIds:
          resolvedAssigneeUserIds !== undefined ? resolvedAssigneeUserIds : previousAssigneeIds,
        previousTeamId: existing.teamId,
        newTeamId: input.teamId !== undefined ? input.teamId : existing.teamId,
      };
    }

    await this.activity.logActivity({
      organizationId,
      userId: updated.createdById,
      entityType: EntityType.TASK,
      entityId: taskId,
      action,
      metadata,
    });

    // Notify newly added assignees ONLY (in-app and email)
    for (const newUserId of newlyAddedUserIds) {
      if (newUserId !== updated.createdById) {
        await this.notification.queueNotification({
          userId: newUserId,
          organizationId,
          type: NotificationType.TASK_ASSIGNED,
          title: 'Task Assigned',
          message: `You have been assigned to task "${updated.title}"`,
          metadata: { taskId: updated.id, projectId: updated.projectId },
        });
      }

      const assignedUser = memberUsersToEmail.find((u) => u.id === newUserId);
      if (assignedUser?.email) {
        await this.email.queueEmail({
          to: assignedUser.email,
          subject: `You have been assigned to task: ${updated.title}`,
          text: `Hello ${assignedUser.name},\n\nYou have been assigned to task "${updated.title}".\n\nLog in to your workspace to view task details.`,
          html: `<p>Hello ${assignedUser.name},</p><p>You have been assigned to task <strong>"${updated.title}"</strong>.</p><p>Log in to your workspace to view task details.</p>`,
          userId: assignedUser.id,
        });
      }
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

    const result: TaskResponse = {
      id: updated.id,
      projectId: updated.projectId,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      priority: updated.priority,
      assigneeId: updated.assignees[0]?.userId ?? updated.assigneeId ?? null,
      assignee: updated.assignees[0]?.user ?? updated.assignee ?? null,
      assignees: updated.assignees.map((a) => ({
        id: a.id,
        userId: a.userId,
        user: a.user,
      })),
      teamId: updated.teamId,
      team: updated.team,
      createdById: updated.createdById,
      createdBy: updated.createdBy,
      dueDate: updated.dueDate,
      position: updated.position,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      _count: updated._count,
    };

    // Emit realtime events
    emitToProject(organizationId, projectId, 'task.updated', result);
    emitToTask(organizationId, taskId, 'task.updated', result);

    if (input.status && input.status !== existing.status) {
      const statusPayload = {
        ...result,
        previousStatus: existing.status,
        newStatus: input.status,
      };
      emitToProject(organizationId, projectId, 'task.status_changed', statusPayload);
      emitToTask(organizationId, taskId, 'task.status_changed', statusPayload);
    }

    if (
      (resolvedAssigneeUserIds !== undefined &&
        (resolvedAssigneeUserIds.length !== previousAssigneeIds.length ||
          newlyAddedUserIds.length > 0)) ||
      (input.teamId !== undefined && input.teamId !== existing.teamId)
    ) {
      const assignPayload = {
        ...result,
        previousAssigneeIds,
        newAssigneeIds: resolvedAssigneeUserIds ?? previousAssigneeIds,
      };
      emitToProject(organizationId, projectId, 'task.assignment_changed', assignPayload);
      emitToTask(organizationId, taskId, 'task.assignment_changed', assignPayload);
    }

    return result;
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

    const deletePayload = { id: taskId, taskId, projectId };
    emitToProject(organizationId, projectId, 'task.deleted', deletePayload);
    emitToTask(organizationId, taskId, 'task.deleted', deletePayload);
  }
}

export const taskService = new TaskService();
