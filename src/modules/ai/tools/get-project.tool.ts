import { z } from 'zod';
import { ALL_ROLES } from '../../../constants/roles.js';
import { projectService, type ProjectService } from '../../projects/project.service.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

export const getProjectSchema = z.object({
  projectId: z.uuid({ message: 'Invalid project ID format' }),
});

export type GetProjectInput = z.infer<typeof getProjectSchema>;

export interface SanitizedProjectDetails {
  id: string;
  name: string;
  key: string;
  description: string | null;
  status: string;
  createdAt: Date;
  createdBy?: {
    name: string;
    email: string;
  };
  tasksCount?: number;
}

export class GetProjectTool implements AgentTool<GetProjectInput, SanitizedProjectDetails> {
  readonly name = 'getProject';
  readonly description = 'Get detailed information about a specific project by its ID within the organization.';
  readonly requiredRoles = ALL_ROLES;
  readonly schema = getProjectSchema;

  readonly toolDefinition = {
    name: 'getProject',
    description: 'Get detailed information about a specific project by its ID within the organization.',
    parameters: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The unique UUID of the project' },
      },
      required: ['projectId'],
    },
  };

  constructor(private readonly service: ProjectService = projectService) {}

  async execute(
    context: AiRequestContext,
    input: GetProjectInput,
  ): Promise<ToolResult<SanitizedProjectDetails>> {
    try {
      const p = await this.service.getProjectById(context.organizationId, input.projectId);

      const sanitized: SanitizedProjectDetails = {
        id: p.id,
        name: p.name,
        key: p.key,
        description: p.description,
        status: p.status,
        createdAt: p.createdAt,
        createdBy: p.createdBy ? { name: p.createdBy.name, email: p.createdBy.email } : undefined,
        tasksCount: p._count?.tasks,
      };

      return {
        success: true,
        data: sanitized,
        sourceCount: 1,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Project not found';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const getProjectTool = new GetProjectTool();
