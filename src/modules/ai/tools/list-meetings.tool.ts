import { z } from 'zod';
import { ALL_ROLES } from '../../../constants/roles.js';
import { meetingService, type MeetingService } from '../../meetings/meeting.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const listMeetingsSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  projectId: z.uuid({ message: 'Invalid project ID format' }).optional(),
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export type ListMeetingsInput = z.infer<typeof listMeetingsSchema>;

export interface SanitizedMeetingSummary {
  id: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  projectId: string | null;
  googleHtmlLink: string | null;
  googleMeetLink: string | null;
  isMeetEnabled: boolean;
}

export class ListMeetingsTool implements AgentTool<ListMeetingsInput, SanitizedMeetingSummary[]> {
  readonly name = 'listMeetings';
  readonly description =
    'List upcoming or past meetings in the organization. Can filter by date range and project.';
  readonly requiredRoles = ALL_ROLES;
  readonly riskLevel = 'READ' as const;
  readonly requiresConfirmation = false;
  readonly schema = listMeetingsSchema;

  readonly toolDefinition = {
    name: 'listMeetings',
    description:
      'List upcoming or past meetings in the organization. Can filter by date range and project.',
    parameters: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'ISO 8601 start date to filter meetings from' },
        to: { type: 'string', description: 'ISO 8601 end date to filter meetings until' },
        projectId: { type: 'string', description: 'UUID of the project to filter meetings by' },
        limit: {
          type: 'number',
          description: 'Maximum number of meetings to return (max 20, default 10)',
        },
      },
    },
  };

  constructor(private readonly service: MeetingService = meetingService) {}

  async execute(
    context: AiRequestContext,
    input: ListMeetingsInput,
  ): Promise<ToolResult<SanitizedMeetingSummary[]>> {
    try {
      const result = await this.service.getMeetings(context.organizationId, {
        page: 1,
        limit: input.limit,
        projectId: input.projectId,
        from: input.from,
        to: input.to,
      });

      const sanitized: SanitizedMeetingSummary[] = result.items.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        startTime: m.startTime,
        endTime: m.endTime,
        location: m.location,
        projectId: m.projectId,
        googleHtmlLink: m.googleHtmlLink,
        googleMeetLink: m.googleMeetLink,
        isMeetEnabled: m.isMeetEnabled,
      }));

      return {
        success: true,
        data: sanitized,
        sourceCount: sanitized.length,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to list meetings';
      return { success: false, error: errorMessage };
    }
  }
}

export const listMeetingsTool = new ListMeetingsTool();
