import { z } from 'zod';
import { ALL_ROLES } from '../../../constants/roles.js';
import { projectService, type ProjectService } from '../../projects/project.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const searchProjectsSchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export type SearchProjectsInput = z.infer<typeof searchProjectsSchema>;

export interface SanitizedProjectSummary {
  id: string;
  name: string;
  key: string;
  description: string | null;
  status: string;
  createdAt: Date;
  tasksCount?: number;
}

export class SearchProjectsTool implements AgentTool<
  SearchProjectsInput,
  SanitizedProjectSummary[]
> {
  readonly name = 'searchProjects';
  readonly description =
    'Search and list projects within the current organization by status or keyword.';
  readonly requiredRoles = ALL_ROLES;
  readonly riskLevel = 'READ' as const;
  readonly requiresConfirmation = false;
  readonly schema = searchProjectsSchema;

  readonly toolDefinition = {
    name: 'searchProjects',
    description: 'Search and list projects within the current organization by status or keyword.',
    parameters: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search term for project name or key' },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'ARCHIVED'],
          description: 'Filter by project status',
        },
        limit: { type: 'number', description: 'Maximum number of projects to return (max 20)' },
      },
    },
  };

  constructor(private readonly service: ProjectService = projectService) {}

  async execute(
    context: AiRequestContext,
    input: SearchProjectsInput,
  ): Promise<ToolResult<SanitizedProjectSummary[]>> {
    try {
      const result = await this.service.getProjects(context.organizationId, {
        search: input.search,
        status: input.status,
        limit: input.limit,
        page: 1,
      });

      const sanitized: SanitizedProjectSummary[] = result.items.map((p) => ({
        id: p.id,
        name: p.name,
        key: p.key,
        description: p.description,
        status: p.status,
        createdAt: p.createdAt,
        tasksCount: p._count?.tasks,
      }));

      return {
        success: true,
        data: sanitized,
        sourceCount: sanitized.length,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to search projects';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const searchProjectsTool = new SearchProjectsTool();
