import { z } from 'zod';
import { OrganizationRole } from '../../constants/roles.js';

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Organization name is required')
    .max(100, 'Organization name cannot exceed 100 characters'),
  slug: z
    .string()
    .trim()
    .min(2, 'Slug must be at least 2 characters')
    .max(50, 'Slug cannot exceed 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase alphanumeric characters and hyphens')
    .optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Organization name is required')
      .max(100, 'Organization name cannot exceed 100 characters')
      .optional(),
    slug: z
      .string()
      .trim()
      .min(2, 'Slug must be at least 2 characters')
      .max(50, 'Slug cannot exceed 50 characters')
      .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase alphanumeric characters and hyphens')
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.slug !== undefined, {
    message: 'At least one field (name or slug) must be provided for update',
  });

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const organizationIdParamSchema = z.object({
  id: z.uuid('Invalid organization ID format'),
});

export type OrganizationIdParam = z.infer<typeof organizationIdParamSchema>;

export const organizationMemberParamSchema = z.object({
  id: z.uuid('Invalid organization ID format'),
  userId: z.uuid('Invalid user ID format'),
});

export type OrganizationMemberParam = z.infer<typeof organizationMemberParamSchema>;

export const addMemberSchema = z.object({
  email: z.email('Invalid email address').transform((val) => val.trim().toLowerCase()),
  role: z
    .enum([OrganizationRole.ADMIN, OrganizationRole.MEMBER, OrganizationRole.VIEWER])
    .default(OrganizationRole.MEMBER),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum([OrganizationRole.ADMIN, OrganizationRole.MEMBER, OrganizationRole.VIEWER]),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
