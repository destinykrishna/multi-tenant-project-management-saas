import { z } from 'zod';
import { OrganizationRole } from '../../../constants/roles.js';
import { TaskPriority, TaskStatus } from '../../../constants/task.js';
import { taskService, type TaskService } from '../../tasks/task.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const createTaskSchema = z.object({
  projectId: z.uuid({ message: 'Invalid project ID format' }),
  title: z
    .string()
    .trim()
    .min(1, 'Task title is required')
    .max(200, 'Task title cannot exceed 200 characters'),
  description: z
    .string()
    .trim()
    .max(2000, 'Task description cannot exceed 2000 characters')
    .optional(),
  priority: z
    .enum([TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT])
    .default(TaskPriority.MEDIUM),
  status: z
    .enum([
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.IN_REVIEW,
      TaskStatus.DONE,
      TaskStatus.CANCELLED,
    ])
    .default(TaskStatus.TODO),
  assigneeId: z.uuid({ message: 'Invalid assignee user ID' }).optional(),
  dueDate: z.coerce.date().optional(),
});

export type CreateTaskToolInput = z.infer<typeof createTaskSchema>;

export interface SanitizedTaskMutationResult {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  position: number;
  assignee?: {
    id: string;
    name: string;
    email: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export class CreateTaskTool implements AgentTool<CreateTaskToolInput, SanitizedTaskMutationResult> {
  readonly name = 'createTask';
  readonly description =
    'Create a new task inside a specific project within the current organization.';
  readonly requiredRoles = [
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.MEMBER,
  ];
  readonly riskLevel = 'WRITE' as const;
  readonly isMutation = true;
  readonly requiresConfirmation = false;
  readonly schema = createTaskSchema;

  readonly toolDefinition = {
    name: 'createTask',
    description: 'Create a new task inside a specific project within the current organization.',
    parameters: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The UUID of the project to create the task in' },
        title: { type: 'string', description: 'The title of the task (1-200 chars)' },
        description: { type: 'string', description: 'Detailed description of the task' },
        priority: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
          description: 'Task priority (default MEDIUM)',
        },
        status: {
          type: 'string',
          enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'],
          description: 'Task status (default TODO)',
        },
        assigneeId: { type: 'string', description: 'The UUID of the user to assign the task to' },
        dueDate: { type: 'string', description: 'ISO 8601 formatted due date string' },
      },
      required: ['projectId', 'title'],
    },
  };

  constructor(private readonly service: TaskService = taskService) {}

  async execute(
    context: AiRequestContext,
    input: CreateTaskToolInput,
  ): Promise<ToolResult<SanitizedTaskMutationResult>> {
    try {
      const task = await this.service.createTask(
        context.organizationId,
        input.projectId,
        context.userId,
        {
          title: input.title,
          description: input.description,
          priority: input.priority,
          status: input.status,
          assigneeId: input.assigneeId,
          dueDate: input.dueDate,
        },
      );

      const sanitized: SanitizedTaskMutationResult = {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        position: task.position,
        assignee: task.assignee
          ? { id: task.assignee.id, name: task.assignee.name, email: task.assignee.email }
          : null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };

      return {
        success: true,
        data: sanitized,
        sourceCount: 1,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create task';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const createTaskTool = new CreateTaskTool();
