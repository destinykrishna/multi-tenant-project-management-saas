import { z } from 'zod';
import { ALL_ROLES } from '../../../constants/roles.js';
import {
  organizationService,
  type OrganizationService,
} from '../../organizations/organization.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const getMemberSchema = z.object({
  memberId: z.uuid({ message: 'Invalid member ID format' }),
});

export type GetMemberInput = z.infer<typeof getMemberSchema>;

export interface SanitizedMemberDetails {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: Date;
}

export class GetMemberTool implements AgentTool<GetMemberInput, SanitizedMemberDetails> {
  readonly name = 'getMember';
  readonly description =
    'Get detailed information about a specific organization member by member ID or user ID.';
  readonly requiredRoles = ALL_ROLES;
  readonly riskLevel = 'READ' as const;
  readonly requiresConfirmation = false;
  readonly schema = getMemberSchema;

  readonly toolDefinition = {
    name: 'getMember',
    description:
      'Get detailed information about a specific organization member by member ID or user ID.',
    parameters: {
      type: 'object' as const,
      properties: {
        memberId: { type: 'string', description: 'The unique UUID of the membership or user' },
      },
      required: ['memberId'],
    },
  };

  constructor(private readonly service: OrganizationService = organizationService) {}

  async execute(
    context: AiRequestContext,
    input: GetMemberInput,
  ): Promise<ToolResult<SanitizedMemberDetails>> {
    try {
      const members = await this.service.getMembers(context.organizationId);
      const member = members.find((m) => m.id === input.memberId || m.userId === input.memberId);

      if (!member) {
        return {
          success: false,
          error: 'Member not found in this organization',
        };
      }

      const sanitized: SanitizedMemberDetails = {
        id: member.id,
        userId: member.userId,
        role: member.role,
        name: member.user.name,
        email: member.user.email,
        createdAt: member.createdAt,
      };

      return {
        success: true,
        data: sanitized,
        sourceCount: 1,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Member not found';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const getMemberTool = new GetMemberTool();
