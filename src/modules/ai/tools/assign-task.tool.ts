import { z } from 'zod';
import { OrganizationRole } from '../../../constants/roles.js';
import { taskService, type TaskService } from '../../tasks/task.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';
import type { SanitizedTaskMutationResult } from './create-task.tool.js';

export const assignTaskToolSchema = z.object({
  taskId: z.uuid({ message: 'Invalid task ID format' }),
  projectId: z.uuid({ message: 'Invalid project ID format' }).optional(),
  assigneeId: z.uuid({ message: 'Invalid assignee user ID' }).nullable(),
});

export type AssignTaskToolInput = z.infer<typeof assignTaskToolSchema>;

export class AssignTaskTool implements AgentTool<AssignTaskToolInput, SanitizedTaskMutationResult> {
  readonly name = 'assignTask';
  readonly description = 'Assign an existing task to an organization member or unassign it (null).';
  readonly requiredRoles = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER];
  readonly riskLevel = 'WRITE' as const;
  readonly isMutation = true;
  readonly requiresConfirmation = false;
  readonly schema = assignTaskToolSchema;

  readonly toolDefinition = {
    name: 'assignTask',
    description: 'Assign an existing task to an organization member or unassign it (null).',
    parameters: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The unique UUID of the task to assign' },
        projectId: { type: 'string', description: 'The UUID of the project the task belongs to (optional)' },
        assigneeId: {
          type: 'string',
          description: 'The UUID of the user to assign the task to (or null to unassign)',
        },
      },
      required: ['taskId', 'assigneeId'],
    },
  };

  constructor(private readonly service: TaskService = taskService) {}

  async execute(
    context: AiRequestContext,
    input: AssignTaskToolInput,
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
          assigneeId: input.assigneeId,
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
      const errorMessage = err instanceof Error ? err.message : 'Failed to assign task';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const assignTaskTool = new AssignTaskTool();
