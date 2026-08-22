import { OrganizationRole } from '../../../constants/roles.js';
import { logger } from '../../../config/logger.js';
import type { AiRequestContext, ToolDefinition } from '../ai.types.js';
import type { AgentTool, ToolResult } from './tool.interface.js';

import { searchProjectsTool } from './search-projects.tool.js';
import { getProjectTool } from './get-project.tool.js';
import { searchTasksTool } from './search-tasks.tool.js';
import { getTaskTool } from './get-task.tool.js';
import { searchMembersTool } from './search-members.tool.js';
import { getMemberTool } from './get-member.tool.js';
import { getRecentActivityTool } from './get-recent-activity.tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor() {
    this.register(searchProjectsTool);
    this.register(getProjectTool);
    this.register(searchTasksTool);
    this.register(getTaskTool);
    this.register(searchMembersTool);
    this.register(getMemberTool);
    this.register(getRecentActivityTool);
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(context?: AiRequestContext): ToolDefinition[] {
    const userRole = (context?.userRole as OrganizationRole | undefined) ?? OrganizationRole.VIEWER;
    return Array.from(this.tools.values())
      .filter((tool) => tool.requiredRoles.includes(userRole))
      .map((tool) => tool.toolDefinition);
  }

  async executeTool(
    name: string,
    context: AiRequestContext,
    rawInput: unknown,
  ): Promise<ToolResult> {
    if (!context.organizationId || !context.userId) {
      return {
        success: false,
        error: 'Authentication and organization context required for tool execution',
      };
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" is not recognized or not available`,
      };
    }

    const userRole = (context.userRole as OrganizationRole | undefined) ?? OrganizationRole.VIEWER;
    if (!tool.requiredRoles.includes(userRole)) {
      return {
        success: false,
        error: `Role "${userRole}" is not authorized to execute tool "${name}"`,
      };
    }

    // Validate inputs with Zod
    const parsed = tool.schema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const formattedErrors = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ');

      return {
        success: false,
        error: `Tool argument validation failed: ${formattedErrors}`,
      };
    }

    try {
      logger.debug(
        {
          tool: name,
          organizationId: context.organizationId,
          userId: context.userId,
        },
        'Executing agent read-only tool',
      );

      return await tool.execute(context, parsed.data);
    } catch (err: unknown) {
      logger.error(
        { tool: name, organizationId: context.organizationId, err },
        'Unexpected tool execution error',
      );

      const message = err instanceof Error ? err.message : 'Tool execution encountered an error';
      return {
        success: false,
        error: message,
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();
