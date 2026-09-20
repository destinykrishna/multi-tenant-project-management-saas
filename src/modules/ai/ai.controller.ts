import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { agentOrchestrator, type AgentOrchestrator } from './agent.orchestrator.js';
import type { AgentRunRequestBody } from './ai.schema.js';
import type { AiRequestContext } from './ai.types.js';

export class AiController {
  constructor(private readonly orchestrator: AgentOrchestrator = agentOrchestrator) {}

  runAgent = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const context: AiRequestContext = {
      organizationId: req.membership.organizationId,
      userId: req.user.id,
      userRole: req.membership.role,
    };

    const body = req.body as AgentRunRequestBody;

    const result = await this.orchestrator.run(context, {
      message: body.message,
      includeRagContext: body.includeRagContext,
      temperature: body.temperature,
      maxSteps: body.maxSteps,
      maxToolCalls: body.maxToolCalls,
      timeoutMs: body.timeoutMs,
    });

    sendSuccess(res, result, 200, 'Agent response generated successfully');
  };
}

export const aiController = new AiController();
