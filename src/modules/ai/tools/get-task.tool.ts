import { z } from 'zod';
import { ALL_ROLES } from '../../../constants/roles.js';
import { taskService, type TaskService } from '../../tasks/task.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const getTaskSchema = z.object({
  projectId: z.uuid({ message: 'Invalid project ID format' }),
  taskId: z.uuid({ message: 'Invalid task ID format' }),
});

export type GetTaskInput = z.infer<typeof getTaskSchema>;

export interface SanitizedTaskDetails {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  assignee?: {
    id: string;
    name: string;
    email: string;
  } | null;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  commentsCount?: number;
}

export class GetTaskTool implements AgentTool<GetTaskInput, SanitizedTaskDetails> {
  readonly name = 'getTask';
  readonly description =
    'Get detailed information about a specific task by its ID within a project.';
  readonly requiredRoles = ALL_ROLES;
  readonly riskLevel = 'READ' as const;
  readonly requiresConfirmation = false;
  readonly schema = getTaskSchema;

  readonly toolDefinition = {
    name: 'getTask',
    description: 'Get detailed information about a specific task by its ID within a project.',
    parameters: {
      type: 'object' as const,
      properties: {
        projectId: {
          type: 'string',
          description: 'The unique UUID of the project the task belongs to',
        },
        taskId: { type: 'string', description: 'The unique UUID of the task' },
      },
      required: ['projectId', 'taskId'],
    },
  };

  constructor(private readonly service: TaskService = taskService) {}

  async execute(
    context: AiRequestContext,
    input: GetTaskInput,
  ): Promise<ToolResult<SanitizedTaskDetails>> {
    try {
      const t = await this.service.getTaskById(
        context.organizationId,
        input.projectId,
        input.taskId,
      );

      const sanitized: SanitizedTaskDetails = {
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        position: t.position,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        assignee: t.assignee
          ? { id: t.assignee.id, name: t.assignee.name, email: t.assignee.email }
          : null,
        createdBy: t.createdBy
          ? { id: t.createdBy.id, name: t.createdBy.name, email: t.createdBy.email }
          : null,
        commentsCount: t._count?.comments,
      };

      return {
        success: true,
        data: sanitized,
        sourceCount: 1,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Task not found';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const getTaskTool = new GetTaskTool();
