import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Team name is required')
    .max(100, 'Team name cannot exceed 100 characters'),
  description: z
    .string()
    .trim()
    .max(500, 'Description cannot exceed 500 characters')
    .nullable()
    .optional(),
  memberUserIds: z.array(z.uuid('Invalid user ID format')).optional(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Team name is required')
      .max(100, 'Team name cannot exceed 100 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description cannot exceed 500 characters')
      .nullable()
      .optional(),
    memberUserIds: z.array(z.uuid('Invalid user ID format')).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined || data.description !== undefined || data.memberUserIds !== undefined,
    {
      message: 'At least one field must be provided for update',
    },
  );

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const orgParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
});

export const teamParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  teamId: z.uuid('Invalid team ID format'),
});
