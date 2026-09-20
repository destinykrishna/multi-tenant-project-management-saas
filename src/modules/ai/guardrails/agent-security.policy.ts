import { OrganizationRole } from '../../../constants/roles.js';
import { ForbiddenError, ValidationError } from '../../../utils/errors.js';
import type { AiRequestContext } from '../ai.types.js';
import type { AgentTool } from '../tools/tool.interface.js';
import { SensitiveDataSanitizer } from './sensitive-data.sanitizer.js';

export interface ToolSecurityEvaluationResult {
  allowed: boolean;
  sanitizedInput?: unknown;
  requiresConfirmation?: boolean;
  reason?: string;
}

export interface SecurityExecutionStats {
  totalToolCalls: number;
  mutationCalls: number;
  maxMutations?: number;
}

export class AgentSecurityPolicy {
  private readonly DEFAULT_MAX_MUTATIONS = 3;

  /**
   * Central security policy evaluation before dispatching any agent tool call.
   */
  evaluateToolExecution(
    tool: AgentTool | undefined,
    toolName: string,
    context: AiRequestContext,
    input: unknown,
    stats: SecurityExecutionStats,
  ): ToolSecurityEvaluationResult {
    // 1. Tool Allowlist Check
    if (!tool) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not registered or allowed. Only explicitly approved tools may execute.`,
      };
    }

    // 2. Tenant & Session Immutability
    if (!context.organizationId || !context.userId) {
      return {
        allowed: false,
        reason: 'Missing immutable tenant or user authentication context for tool execution.',
      };
    }

    // 3. RBAC Privilege Boundary Check
    const userRole = context.userRole as OrganizationRole;
    if (!tool.requiredRoles.includes(userRole)) {
      return {
        allowed: false,
        reason: `Caller with role "${userRole}" is not authorized to execute ${tool.riskLevel} tool "${tool.name}".`,
      };
    }

    // 4. Confirmation & Destructive Action Policy
    if (tool.riskLevel === 'DESTRUCTIVE' || tool.requiresConfirmation) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Execution of destructive tool "${tool.name}" requires explicit user confirmation.`,
      };
    }

    // 5. Mutation Limits & Cost Safeguard (covers WRITE + EXTERNAL_SIDE_EFFECT)
    const maxMutations = stats.maxMutations ?? this.DEFAULT_MAX_MUTATIONS;
    if (
      (tool.isMutation || tool.riskLevel === 'WRITE' || tool.riskLevel === 'EXTERNAL_SIDE_EFFECT') &&
      stats.mutationCalls >= maxMutations
    ) {
      return {
        allowed: false,
        reason: `Maximum mutation limit (${maxMutations}) reached for this agent request. No further write or side-effect operations allowed.`,
      };
    }

    // 6. Sensitive Data Input Scrubbing
    const sanitizedInput = SensitiveDataSanitizer.sanitizeValue(input);

    return {
      allowed: true,
      sanitizedInput,
    };
  }

  /**
   * Validates that the agent request context conforms to security invariants.
   */
  validateRequestContext(context: AiRequestContext): void {
    if (!context.organizationId || typeof context.organizationId !== 'string' || !context.userId || typeof context.userId !== 'string') {
      throw new ValidationError('Authentication and organization context are required for agent execution');
    }

    const validRoles = Object.values(OrganizationRole);
    if (!context.userRole || !validRoles.includes(context.userRole as OrganizationRole)) {
      throw new ForbiddenError('Invalid caller role for AI agent execution');
    }
  }
}

export const agentSecurityPolicy = new AgentSecurityPolicy();
