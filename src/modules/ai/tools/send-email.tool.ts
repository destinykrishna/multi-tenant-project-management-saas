import { z } from 'zod';
import { OrganizationRole } from '../../../constants/roles.js';
import { gmailService, type GmailService } from '../../integrations/google/gmail.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const sendEmailSchema = z.object({
  to: z.email({ message: 'Recipient email address must be a valid email' }).max(254),
  subject: z.string().trim().min(1, 'Email subject is required').max(200),
  body: z
    .string()
    .trim()
    .min(1, 'Email body is required')
    .max(4000, 'Email body cannot exceed 4000 characters'),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export interface SanitizedEmailSendResult {
  messageId: string;
  provider: 'smtp' | 'gmail';
  timestamp?: string;
}

export class SendEmailTool implements AgentTool<SendEmailInput, SanitizedEmailSendResult> {
  readonly name = 'sendEmail';
  readonly description =
    "Send an email from the authenticated user's connected Google/Gmail account. " +
    'Only use when the user explicitly requests sending an email. ' +
    "Requires the caller's Google account to be connected and have Gmail send permissions.";
  readonly requiredRoles = [
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.MEMBER,
  ];
  readonly riskLevel = 'EXTERNAL_SIDE_EFFECT' as const;
  readonly isMutation = true;
  readonly requiresConfirmation = false;
  readonly schema = sendEmailSchema;

  readonly toolDefinition = {
    name: 'sendEmail',
    description:
      "Send an email from the authenticated user's connected Gmail account. " +
      'Only use when the user explicitly requests sending an email.',
    parameters: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address (required)' },
        subject: { type: 'string', description: 'Email subject line (required)' },
        body: {
          type: 'string',
          description: 'Plain-text email body content (required, max 4000 characters)',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  };

  constructor(private readonly service: GmailService = gmailService) {}

  async execute(
    context: AiRequestContext,
    input: SendEmailInput,
  ): Promise<ToolResult<SanitizedEmailSendResult>> {
    try {
      const result = await this.service.sendEmail(context.userId, {
        to: input.to,
        subject: input.subject,
        text: input.body,
        userId: context.userId,
      });

      const sanitized: SanitizedEmailSendResult = {
        messageId: result.messageId,
        provider: result.provider,
        timestamp: result.timestamp,
      };

      return {
        success: true,
        data: sanitized,
        sourceCount: 1,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send email';
      return { success: false, error: errorMessage };
    }
  }
}

export const sendEmailTool = new SendEmailTool();
