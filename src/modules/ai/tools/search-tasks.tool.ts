import { z } from 'zod';
import { ALL_ROLES } from '../../../constants/roles.js';
import { TaskPriority, TaskStatus } from '../../../constants/task.js';
import { taskService, type TaskService } from '../../tasks/task.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const searchTasksSchema = z.object({
  projectId: z.uuid({ message: 'Invalid project ID format' }),
  search: z.string().max(100).optional(),
  status: z
    .enum([
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.IN_REVIEW,
      TaskStatus.DONE,
      TaskStatus.CANCELLED,
    ])
    .optional(),
  priority: z
    .enum([TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT])
    .optional(),
  assigneeId: z.uuid().optional(),
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export type SearchTasksInput = z.infer<typeof searchTasksSchema>;

export interface SanitizedTaskSummary {
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
  commentsCount?: number;
}

export class SearchTasksTool implements AgentTool<SearchTasksInput, SanitizedTaskSummary[]> {
  readonly name = 'searchTasks';
  readonly description =
    'Search and list tasks inside a specific project by keyword, status, priority, or assignee.';
  readonly requiredRoles = ALL_ROLES;
  readonly riskLevel = 'READ' as const;
  readonly requiresConfirmation = false;
  readonly schema = searchTasksSchema;

  readonly toolDefinition = {
    name: 'searchTasks',
    description:
      'Search and list tasks inside a specific project by keyword, status, priority, or assignee.',
    parameters: {
      type: 'object' as const,
      properties: {
        projectId: {
          type: 'string',
          description: 'The unique UUID of the project to search tasks in',
        },
        search: { type: 'string', description: 'Search term matching task title or description' },
        status: {
          type: 'string',
          enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'],
          description: 'Filter by task status',
        },
        priority: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
          description: 'Filter by task priority',
        },
        assigneeId: { type: 'string', description: 'Filter by assignee user ID' },
        limit: { type: 'number', description: 'Maximum number of tasks to return (max 20)' },
      },
      required: ['projectId'],
    },
  };

  constructor(private readonly service: TaskService = taskService) {}

  async execute(
    context: AiRequestContext,
    input: SearchTasksInput,
  ): Promise<ToolResult<SanitizedTaskSummary[]>> {
    try {
      const result = await this.service.getTasks(context.organizationId, input.projectId, {
        search: input.search,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId,
        limit: input.limit,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      const sanitized: SanitizedTaskSummary[] = result.items.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        position: t.position,
        assignee: t.assignee
          ? { id: t.assignee.id, name: t.assignee.name, email: t.assignee.email }
          : null,
        commentsCount: t._count?.comments,
      }));

      return {
        success: true,
        data: sanitized,
        sourceCount: sanitized.length,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to search tasks';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const searchTasksTool = new SearchTasksTool();
