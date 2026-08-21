import { z } from 'zod';

export const dashboardParamsSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
});

export const getDashboardQuerySchema = z.object({
  recentActivityLimit: z
    .preprocess((val) => (val !== undefined ? Number(val) : 5), z.number().int().min(1).max(50))
    .default(5),
  recentNotificationsLimit: z
    .preprocess((val) => (val !== undefined ? Number(val) : 5), z.number().int().min(1).max(50))
    .default(5),
});

export type DashboardParams = z.infer<typeof dashboardParamsSchema>;
export type GetDashboardQuery = z.infer<typeof getDashboardQuerySchema>;
