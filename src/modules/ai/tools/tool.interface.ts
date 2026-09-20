import type { z } from 'zod';
import type { OrganizationRole } from '../../../constants/roles.js';
import type { AiRequestContext, ToolDefinition } from '../ai.types.js';

export type ToolRiskLevel = 'READ' | 'WRITE' | 'DESTRUCTIVE' | 'EXTERNAL_SIDE_EFFECT';

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  sourceCount?: number;
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly toolDefinition: ToolDefinition;
  readonly requiredRoles: OrganizationRole[];
  readonly schema: z.ZodType<TInput>;
  readonly riskLevel: ToolRiskLevel;
  readonly requiresConfirmation: boolean;
  readonly isMutation?: boolean;
  execute(context: AiRequestContext, input: TInput): Promise<ToolResult<TOutput>>;
}
