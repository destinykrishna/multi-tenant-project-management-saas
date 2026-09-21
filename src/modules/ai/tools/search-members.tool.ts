import { z } from 'zod';
import { ALL_ROLES, OrganizationRole } from '../../../constants/roles.js';
import {
  organizationService,
  type OrganizationService,
} from '../../organizations/organization.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const searchMembersSchema = z.object({
  search: z.string().max(100).optional(),
  role: z
    .enum([
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ])
    .optional(),
});

export type SearchMembersInput = z.infer<typeof searchMembersSchema>;

export interface SanitizedMemberSummary {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: Date;
}

export class SearchMembersTool implements AgentTool<SearchMembersInput, SanitizedMemberSummary[]> {
  readonly name = 'searchMembers';
  readonly description =
    'List and filter active members and their roles within the current organization.';
  readonly requiredRoles = ALL_ROLES;
  readonly riskLevel = 'READ' as const;
  readonly requiresConfirmation = false;
  readonly schema = searchMembersSchema;

  readonly toolDefinition = {
    name: 'searchMembers',
    description: 'List and filter active members and their roles within the current organization.',
    parameters: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search term matching member name or email' },
        role: {
          type: 'string',
          enum: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
          description: 'Filter by member role',
        },
      },
    },
  };

  constructor(private readonly service: OrganizationService = organizationService) {}

  async execute(
    context: AiRequestContext,
    input: SearchMembersInput,
  ): Promise<ToolResult<SanitizedMemberSummary[]>> {
    try {
      const members = await this.service.getMembers(context.organizationId);

      let filtered = members;

      if (input.role) {
        filtered = filtered.filter((m) => m.role === input.role);
      }

      if (input.search) {
        const query = input.search.toLowerCase();
        filtered = filtered.filter(
          (m) =>
            m.user.name.toLowerCase().includes(query) || m.user.email.toLowerCase().includes(query),
        );
      }

      const sanitized: SanitizedMemberSummary[] = filtered.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        name: m.user.name,
        email: m.user.email,
        createdAt: m.createdAt,
      }));

      return {
        success: true,
        data: sanitized,
        sourceCount: sanitized.length,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to search members';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const searchMembersTool = new SearchMembersTool();
