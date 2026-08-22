import { z } from 'zod';

export const googleCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().min(1, 'State parameter is required'),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;

export const sendGmailSchema = z
  .object({
    to: z
      .union([z.email(), z.array(z.email()).min(1)])
      .describe('Recipient email address or array of email addresses'),
    subject: z.string().min(1, 'Subject cannot be empty'),
    text: z.string().optional(),
    html: z.string().optional(),
  })
  .refine((data) => data.text || data.html, {
    message: 'Either text or html body must be provided',
    path: ['text'],
  });

export type SendGmailInput = z.infer<typeof sendGmailSchema>;

export const createCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z.string().max(2000).optional(),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    location: z.string().max(300).optional(),
    attendees: z.array(z.email()).optional(),
  })
  .refine((data) => data.endTime.getTime() > data.startTime.getTime(), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;

export const updateCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional().nullable(),
    startTime: z.coerce.date().optional(),
    endTime: z.coerce.date().optional(),
    location: z.string().max(300).optional().nullable(),
    attendees: z.array(z.email()).optional(),
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

export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;

export const listCalendarEventsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListCalendarEventsQuery = z.infer<typeof listCalendarEventsQuerySchema>;
