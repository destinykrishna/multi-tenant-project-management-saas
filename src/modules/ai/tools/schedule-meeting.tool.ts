import { z } from 'zod';
import { OrganizationRole } from '../../../constants/roles.js';
import { meetingService, type MeetingService } from '../../meetings/meeting.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const scheduleMeetingSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Meeting title is required')
    .max(200, 'Meeting title cannot exceed 200 characters'),
  startTime: z.coerce.date({ message: 'startTime must be a valid ISO 8601 date string' }),
  endTime: z.coerce.date({ message: 'endTime must be a valid ISO 8601 date string' }),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(300).optional(),
  projectId: z.uuid({ message: 'Invalid project ID format' }).optional(),
  taskId: z.uuid({ message: 'Invalid task ID format' }).optional(),
  createGoogleMeet: z.boolean().optional().default(true),
}).refine(
  (data) => data.endTime.getTime() > data.startTime.getTime(),
  { message: 'End time must be after start time', path: ['endTime'] },
);

export type ScheduleMeetingInput = z.infer<typeof scheduleMeetingSchema>;

export interface SanitizedMeetingResult {
  id: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  projectId: string | null;
  taskId: string | null;
  googleEventId: string | null;
  googleHtmlLink: string | null;
  googleMeetLink: string | null;
  isMeetEnabled: boolean;
}

export class ScheduleMeetingTool implements AgentTool<ScheduleMeetingInput, SanitizedMeetingResult> {
  readonly name = 'scheduleMeeting';
  readonly description =
    'Schedule a new meeting for the organization. Optionally creates a Google Calendar event with a Google Meet link. '
    + 'Requires the caller to have a connected Google account for Google Calendar/Meet integration.';
  readonly requiredRoles = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER];
  readonly riskLevel = 'EXTERNAL_SIDE_EFFECT' as const;
  readonly isMutation = true;
  readonly requiresConfirmation = false;
  readonly schema = scheduleMeetingSchema;

  readonly toolDefinition = {
    name: 'scheduleMeeting',
    description:
      'Schedule a new meeting for the organization. Optionally creates a Google Calendar event with a Google Meet link. '
      + 'Requires the caller to have a connected Google account for Google Calendar/Meet integration.',
    parameters: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Meeting title (required)' },
        startTime: { type: 'string', description: 'ISO 8601 start date-time of the meeting (required)' },
        endTime: { type: 'string', description: 'ISO 8601 end date-time of the meeting (required)' },
        description: { type: 'string', description: 'Optional description or agenda for the meeting' },
        location: { type: 'string', description: 'Optional physical or virtual location' },
        projectId: { type: 'string', description: 'Optional UUID of the project to link this meeting to' },
        taskId: { type: 'string', description: 'Optional UUID of the task to link this meeting to' },
        createGoogleMeet: {
          type: 'boolean',
          description: 'Whether to create a Google Meet video conference link (default: true)',
        },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  };

  constructor(private readonly service: MeetingService = meetingService) {}

  async execute(
    context: AiRequestContext,
    input: ScheduleMeetingInput,
  ): Promise<ToolResult<SanitizedMeetingResult>> {
    try {
      const meeting = await this.service.createMeeting(
        context.organizationId,
        context.userId,
        {
          title: input.title,
          description: input.description,
          startTime: input.startTime,
          endTime: input.endTime,
          location: input.location,
          projectId: input.projectId,
          taskId: input.taskId,
          syncWithGoogle: true,
          createGoogleMeet: input.createGoogleMeet,
        },
      );

      const sanitized: SanitizedMeetingResult = {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        location: meeting.location,
        projectId: meeting.projectId,
        taskId: meeting.taskId,
        googleEventId: meeting.googleEventId,
        googleHtmlLink: meeting.googleHtmlLink,
        googleMeetLink: meeting.googleMeetLink,
        isMeetEnabled: meeting.isMeetEnabled,
      };

      return {
        success: true,
        data: sanitized,
        sourceCount: 1,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to schedule meeting';
      return { success: false, error: errorMessage };
    }
  }
}

export const scheduleMeetingTool = new ScheduleMeetingTool();
