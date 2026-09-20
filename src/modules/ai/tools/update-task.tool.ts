import { z } from 'zod';
import { OrganizationRole } from '../../../constants/roles.js';
import { TaskPriority, TaskStatus } from '../../../constants/task.js';
import { taskService, type TaskService } from '../../tasks/task.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';
import type { SanitizedTaskMutationResult } from './create-task.tool.js';

export const updateTaskToolSchema = z
  .object({
    taskId: z.uuid({ message: 'Invalid task ID format' }),
    projectId: z.uuid({ message: 'Invalid project ID format' }).optional(),
    title: z
      .string()
      .trim()
      .min(1, 'Task title is required')
      .max(200, 'Task title cannot exceed 200 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, 'Task description cannot exceed 2000 characters')
      .nullable()
      .optional(),
    priority: z
      .enum([TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT])
      .optional(),
    status: z
      .enum([
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW,
        TaskStatus.DONE,
        TaskStatus.CANCELLED,
      ])
      .optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.priority !== undefined ||
      data.status !== undefined ||
      data.dueDate !== undefined,
    {
      message: 'At least one field must be provided to update the task',
    },
  );

export type UpdateTaskToolInput = z.infer<typeof updateTaskToolSchema>;

export class UpdateTaskTool implements AgentTool<UpdateTaskToolInput, SanitizedTaskMutationResult> {
  readonly name = 'updateTask';
  readonly description = 'Update an existing task status, priority, title, description, or due date.';
  readonly requiredRoles = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER];
  readonly riskLevel = 'WRITE' as const;
  readonly isMutation = true;
  readonly requiresConfirmation = false;
  readonly schema = updateTaskToolSchema;

  readonly toolDefinition = {
    name: 'updateTask',
    description: 'Update an existing task status, priority, title, description, or due date.',
    parameters: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The unique UUID of the task to update' },
        projectId: { type: 'string', description: 'The UUID of the project the task belongs to (optional)' },
        title: { type: 'string', description: 'New title for the task' },
        description: { type: 'string', description: 'New description for the task (or null to clear)' },
        status: {
          type: 'string',
          enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'],
          description: 'New status for the task',
        },
        priority: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
          description: 'New priority level',
        },
        dueDate: { type: 'string', description: 'ISO 8601 formatted due date string (or null to clear)' },
      },
      required: ['taskId'],
    },
  };

  constructor(private readonly service: TaskService = taskService) {}

  async execute(
    context: AiRequestContext,
    input: UpdateTaskToolInput,
  ): Promise<ToolResult<SanitizedTaskMutationResult>> {
    try {
      let projectId = input.projectId;
      if (!projectId) {
        const existingTask = await this.service.getTaskInOrg(context.organizationId, input.taskId);
        projectId = existingTask.projectId;
      }

      const updated = await this.service.updateTask(
        context.organizationId,
        projectId,
        input.taskId,
        {
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          dueDate: input.dueDate,
        },
      );

      const sanitized: SanitizedTaskMutationResult = {
        id: updated.id,
        projectId: updated.projectId,
        title: updated.title,
        description: updated.description,
        status: updated.status,
        priority: updated.priority,
        dueDate: updated.dueDate,
        position: updated.position,
        assignee: updated.assignee
          ? { id: updated.assignee.id, name: updated.assignee.name, email: updated.assignee.email }
          : null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };

      return {
        success: true,
        data: sanitized,
        sourceCount: 1,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update task';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const updateTaskTool = new UpdateTaskTool();
