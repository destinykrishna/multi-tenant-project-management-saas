import type { Request, Response } from 'express';
import { sendSuccess } from '../../../utils/response.js';
import { UnauthorizedError } from '../../../utils/errors.js';
import { emailService } from '../../../config/email.js';
import { calendarService, type CalendarService } from '../../calendar/calendar.service.js';
import { googleMeetService, type GoogleMeetService } from '../../meet/meet.service.js';
import { googleService, type GoogleService } from './google.service.js';
import type {
  GoogleCallbackQuery,
  SendGmailInput,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  ListCalendarEventsQuery,
} from './google.schema.js';

export class GoogleController {
  constructor(
    private readonly service: GoogleService = googleService,
    private readonly calService: CalendarService = calendarService,
    private readonly meetService: GoogleMeetService = googleMeetService,
  ) {}

  connect = (req: Request, res: Response): void => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to connect Google account');
    }

    const result = this.service.getAuthorizationUrl(req.user.id);
    sendSuccess(res, result, 200, 'Google authorization URL generated successfully');
  };

  callback = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as GoogleCallbackQuery;

    const result = await this.service.handleCallback(
      query.code,
      query.state,
      query.error,
      query.error_description,
    );

    sendSuccess(res, result, 200, 'Google account connected successfully');
  };

  getStatus = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to check connection status');
    }

    const status = await this.service.getConnectionStatus(req.user.id);
    sendSuccess(res, status, 200, 'Google account connection status retrieved');
  };

  disconnect = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to disconnect Google account');
    }

    const result = await this.service.disconnect(req.user.id);
    sendSuccess(res, result, 200, 'Google account disconnected successfully');
  };

  sendGmail = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to send email via Gmail');
    }

    const body = req.body as unknown as SendGmailInput;

    const job = await emailService.queueEmail({
      to: body.to,
      subject: body.subject,
      text: body.text,
      html: body.html,
      userId: req.user.id,
      provider: 'gmail',
    });

    sendSuccess(
      res,
      {
        queued: true,
        jobId: job.id,
        recipient: body.to,
        subject: body.subject,
        provider: 'gmail',
      },
      202,
      'Email enqueued for sending via Gmail',
    );
  };

  createCalendarEvent = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to create calendar event');
    }

    const body = req.body as CreateCalendarEventInput;
    const event = await this.calService.createEvent(req.user.id, body);

    sendSuccess(res, event, 201, 'Google Calendar event created successfully');
  };

  listCalendarEvents = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to list calendar events');
    }

    const query = req.query as unknown as ListCalendarEventsQuery;
    const events = await this.calService.listEvents(req.user.id, query.from, query.to);

    sendSuccess(res, events, 200, 'Google Calendar events retrieved successfully');
  };

  getCalendarEvent = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to get calendar event');
    }

    const eventId = req.params['eventId'] as string;
    const event = await this.calService.getEvent(req.user.id, eventId);
    sendSuccess(res, event, 200, 'Google Calendar event retrieved successfully');
  };

  updateCalendarEvent = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to update calendar event');
    }

    const eventId = req.params['eventId'] as string;
    const body = req.body as UpdateCalendarEventInput;
    const event = await this.calService.updateEvent(req.user.id, eventId, body);

    sendSuccess(res, event, 200, 'Google Calendar event updated successfully');
  };

  deleteCalendarEvent = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to delete calendar event');
    }

    const eventId = req.params['eventId'] as string;
    await this.calService.deleteEvent(req.user.id, eventId);
    sendSuccess(res, { deleted: true }, 200, 'Google Calendar event deleted successfully');
  };

  generateMeet = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required to generate Google Meet link');
    }

    const body = req.body as CreateCalendarEventInput;
    const conference = await this.meetService.createConference(req.user.id, {
      title: body.title,
      description: body.description,
      startTime: body.startTime,
      endTime: body.endTime,
      location: body.location,
    });

    sendSuccess(res, conference, 201, 'Google Meet link generated successfully');
  };
}

export const googleController = new GoogleController();
