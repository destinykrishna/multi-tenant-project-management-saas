import { z } from 'zod';

export const agentOrgParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
});

export const agentRunRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message is required')
    .max(2000, 'Message cannot exceed 2000 characters'),
  includeRagContext: z.boolean().optional().default(true),
  temperature: z.number().min(0).max(2).optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  maxToolCalls: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

export type AgentOrgParam = z.infer<typeof agentOrgParamSchema>;
export type AgentRunRequestBody = z.infer<typeof agentRunRequestSchema>;
