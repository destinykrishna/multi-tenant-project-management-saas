import { z } from 'zod';

export const commentTaskParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  projectId: z.uuid('Invalid project ID format'),
  taskId: z.uuid('Invalid task ID format'),
});

export const commentParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  projectId: z.uuid('Invalid project ID format'),
  taskId: z.uuid('Invalid task ID format'),
  commentId: z.uuid('Invalid comment ID format'),
});

export const createCommentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Comment content cannot be empty')
    .max(5000, 'Comment content cannot exceed 5000 characters'),
});

export const updateCommentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Comment content cannot be empty')
    .max(5000, 'Comment content cannot exceed 5000 characters'),
});

export const listCommentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
export type CommentTaskParams = z.infer<typeof commentTaskParamSchema>;
export type CommentParams = z.infer<typeof commentParamSchema>;
