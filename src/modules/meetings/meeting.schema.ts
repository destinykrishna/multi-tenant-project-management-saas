import { z } from 'zod';

export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1, 'Meeting title is required').max(200),
    description: z.string().max(2000).optional(),
    startTime: z.coerce.date().describe('Start date and time of the meeting'),
    endTime: z.coerce.date().describe('End date and time of the meeting'),
    location: z.string().max(300).optional(),
    projectId: z.uuid().optional(),
    taskId: z.uuid().optional(),
    syncWithGoogle: z.boolean().optional().default(false),
    createGoogleMeet: z.boolean().optional().default(false),
  })
  .refine((data) => data.endTime.getTime() > data.startTime.getTime(), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export type CreateMeetingSchemaInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional().nullable(),
    startTime: z.coerce.date().optional(),
    endTime: z.coerce.date().optional(),
    location: z.string().max(300).optional().nullable(),
    projectId: z.uuid().optional().nullable(),
    taskId: z.uuid().optional().nullable(),
    syncWithGoogle: z.boolean().optional(),
    createGoogleMeet: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.startTime && data.endTime) {
        return data.endTime.getTime() > data.startTime.getTime();
      }
      return true;
    },
    {
      message: 'End time must be after start time',
      path: ['endTime'],
    },
  );

export type UpdateMeetingSchemaInput = z.infer<typeof updateMeetingSchema>;

export const listMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  projectId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;

export const meetingOrgParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
});

export type MeetingOrgParam = z.infer<typeof meetingOrgParamSchema>;

export const meetingParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  meetingId: z.uuid('Invalid meeting ID format'),
});

export type MeetingParam = z.infer<typeof meetingParamSchema>;
