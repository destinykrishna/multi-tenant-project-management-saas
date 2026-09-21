import { z } from 'zod';

export const attachmentTaskParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  projectId: z.uuid('Invalid project ID format'),
  taskId: z.uuid('Invalid task ID format'),
});

export const attachmentParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  projectId: z.uuid('Invalid project ID format'),
  taskId: z.uuid('Invalid task ID format'),
  attachmentId: z.uuid('Invalid attachment ID format'),
});

export const listAttachmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  sortBy: z.enum(['createdAt', 'size', 'originalName']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type AttachmentTaskParams = z.infer<typeof attachmentTaskParamSchema>;
export type AttachmentParams = z.infer<typeof attachmentParamSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
