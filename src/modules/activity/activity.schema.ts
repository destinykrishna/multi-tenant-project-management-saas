import { z } from 'zod';
import { EntityType, ActivityAction } from '../../constants/activity.js';

export const activityOrgParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
});

export const activityEntityParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  entityType: z.enum([
    EntityType.ORGANIZATION,
    EntityType.PROJECT,
    EntityType.TASK,
    EntityType.COMMENT,
    EntityType.USER,
  ]),
  entityId: z.string().trim().min(1, 'Entity ID is required'),
});

export const listActivityQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  entityType: z
    .enum([
      EntityType.ORGANIZATION,
      EntityType.PROJECT,
      EntityType.TASK,
      EntityType.COMMENT,
      EntityType.USER,
    ])
    .optional(),
  action: z
    .enum([
      ActivityAction.CREATED,
      ActivityAction.UPDATED,
      ActivityAction.DELETED,
      ActivityAction.TASK_STATUS_CHANGED,
      ActivityAction.TASK_ASSIGNED,
      ActivityAction.MEMBER_ADDED,
      ActivityAction.MEMBER_REMOVED,
    ])
    .optional(),
});

export const listEntityActivityQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  action: z
    .enum([
      ActivityAction.CREATED,
      ActivityAction.UPDATED,
      ActivityAction.DELETED,
      ActivityAction.TASK_STATUS_CHANGED,
      ActivityAction.TASK_ASSIGNED,
      ActivityAction.MEMBER_ADDED,
      ActivityAction.MEMBER_REMOVED,
    ])
    .optional(),
});

export type ActivityOrgParams = z.infer<typeof activityOrgParamSchema>;
export type ActivityEntityParams = z.infer<typeof activityEntityParamSchema>;
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
export type ListEntityActivityQuery = z.infer<typeof listEntityActivityQuerySchema>;
