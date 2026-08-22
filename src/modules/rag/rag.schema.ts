import { z } from 'zod';

export const ragOrgParamSchema = z.object({
  organizationId: z.uuid({ message: 'Invalid organization ID format' }),
});

export const listKnowledgeQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sourceType: z.enum(['PROJECT', 'TASK', 'COMMENT', 'ACTIVITY_LOG', 'DOCUMENT']).optional(),
  sourceId: z.string().optional(),
});

export type ListKnowledgeQuery = z.infer<typeof listKnowledgeQuerySchema>;

export const indexEntitySchema = z.object({
  sourceType: z.enum(['PROJECT', 'TASK', 'COMMENT', 'ACTIVITY_LOG'], {
    message: 'sourceType must be one of PROJECT, TASK, COMMENT, ACTIVITY_LOG',
  }),
  sourceId: z.uuid({ message: 'Invalid source ID format' }),
});

export type IndexEntityInput = z.infer<typeof indexEntitySchema>;

export const retrieveKnowledgeSchema = z.object({
  query: z
    .string({ message: 'Query is required' })
    .trim()
    .min(1, 'Query must not be empty')
    .max(2000, 'Query must not exceed 2000 characters'),
  topK: z.coerce.number().int().positive().max(50).optional(),
  minSimilarity: z.coerce.number().min(0).max(1).optional(),
  sourceTypes: z
    .array(z.enum(['PROJECT', 'TASK', 'COMMENT', 'ACTIVITY_LOG', 'DOCUMENT']))
    .optional(),
  projectId: z.uuid({ message: 'Invalid project ID format' }).optional(),
});

export type RetrieveKnowledgeInput = z.infer<typeof retrieveKnowledgeSchema>;

export const queryRagSchema = z.object({
  query: z
    .string({ message: 'Query is required' })
    .trim()
    .min(1, 'Query must not be empty')
    .max(2000, 'Query must not exceed 2000 characters'),
  topK: z.coerce.number().int().positive().max(10).optional(),
  minSimilarity: z.coerce.number().min(0).max(1).optional(),
  sourceTypes: z
    .array(z.enum(['PROJECT', 'TASK', 'COMMENT', 'ACTIVITY_LOG', 'DOCUMENT']))
    .optional(),
  projectId: z.uuid({ message: 'Invalid project ID format' }).optional(),
});

export type QueryRagInput = z.infer<typeof queryRagSchema>;
