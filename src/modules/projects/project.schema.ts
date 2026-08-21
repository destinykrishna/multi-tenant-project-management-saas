import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(100, 'Project name cannot exceed 100 characters'),
  key: z
    .string()
    .trim()
    .min(2, 'Project key must be at least 2 characters')
    .max(10, 'Project key cannot exceed 10 characters')
    .regex(
      /^[A-Za-z0-9_-]+$/,
      'Project key can only contain alphanumeric characters, hyphens, and underscores',
    )
    .transform((val) => val.toUpperCase())
    .optional(),
  description: z
    .string()
    .trim()
    .max(1000, 'Description cannot exceed 1000 characters')
    .nullable()
    .optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Project name is required')
      .max(100, 'Project name cannot exceed 100 characters')
      .optional(),
    key: z
      .string()
      .trim()
      .min(2, 'Project key must be at least 2 characters')
      .max(10, 'Project key cannot exceed 10 characters')
      .regex(
        /^[A-Za-z0-9_-]+$/,
        'Project key can only contain alphanumeric characters, hyphens, and underscores',
      )
      .transform((val) => val.toUpperCase())
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, 'Description cannot exceed 1000 characters')
      .nullable()
      .optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.key !== undefined ||
      data.description !== undefined ||
      data.status !== undefined,
    {
      message: 'At least one field must be provided for update',
    },
  );

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectOrgParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
});

export type ProjectOrgParam = z.infer<typeof projectOrgParamSchema>;

export const projectParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  projectId: z.uuid('Invalid project ID format'),
});

export type ProjectParam = z.infer<typeof projectParamSchema>;

export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  search: z.string().trim().optional(),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
