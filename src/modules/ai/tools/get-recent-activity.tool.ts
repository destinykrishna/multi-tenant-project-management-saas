import { z } from 'zod';
import { ALL_ROLES } from '../../../constants/roles.js';
import { EntityType, ActivityAction } from '../../../constants/activity.js';
import { activityService, type ActivityService } from '../../activity/activity.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const getRecentActivitySchema = z.object({
  entityType: z
    .enum([
      EntityType.ORGANIZATION,
      EntityType.PROJECT,
      EntityType.TASK,
      EntityType.COMMENT,
      EntityType.USER,
    ])
    .optional(),
  action: z
    .enum([
      ActivityAction.CREATED,
      ActivityAction.UPDATED,
      ActivityAction.DELETED,
      ActivityAction.TASK_STATUS_CHANGED,
      ActivityAction.TASK_ASSIGNED,
      ActivityAction.MEMBER_ADDED,
      ActivityAction.MEMBER_REMOVED,
    ])
    .optional(),
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export type GetRecentActivityInput = z.infer<typeof getRecentActivitySchema>;

export interface SanitizedActivityLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  createdAt: Date;
  user: {
    name: string;
    email: string;
  };
}

export class GetRecentActivityTool implements AgentTool<GetRecentActivityInput, SanitizedActivityLog[]> {
  readonly name = 'getRecentActivity';
  readonly description = 'Get recent audit trail and activity history within the organization.';
  readonly requiredRoles = ALL_ROLES;
  readonly schema = getRecentActivitySchema;

  readonly toolDefinition = {
    name: 'getRecentActivity',
    description: 'Get recent audit trail and activity history within the organization.',
    parameters: {
      type: 'object' as const,
      properties: {
        entityType: {
          type: 'string',
          enum: ['ORGANIZATION', 'PROJECT', 'TASK', 'COMMENT', 'USER'],
          description: 'Filter by affected entity type',
        },
        action: { type: 'string', description: 'Filter by specific action performed' },
        limit: { type: 'number', description: 'Maximum number of activity events to return (max 20)' },
      },
    },
  };

  constructor(private readonly service: ActivityService = activityService) {}

  async execute(
    context: AiRequestContext,
    input: GetRecentActivityInput,
  ): Promise<ToolResult<SanitizedActivityLog[]>> {
    try {
      const result = await this.service.getActivities(context.organizationId, {
        entityType: input.entityType,
        action: input.action,
        limit: input.limit,
        page: 1,
      });

      const sanitized: SanitizedActivityLog[] = result.items.map((log) => ({
        id: log.id,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        createdAt: log.createdAt,
        user: { name: log.user.name, email: log.user.email },
      }));

      return {
        success: true,
        data: sanitized,
        sourceCount: sanitized.length,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to retrieve recent activity';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const getRecentActivityTool = new GetRecentActivityTool();
