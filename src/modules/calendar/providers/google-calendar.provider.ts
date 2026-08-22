import { logger } from '../../../config/logger.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  AppError,
} from '../../../utils/errors.js';
import {
  googleService,
  GOOGLE_SCOPES,
  type GoogleService,
} from '../../integrations/google/google.service.js';
import {
  googleRepository,
  type GoogleRepository,
} from '../../integrations/google/google.repository.js';
import type {
  ICalendarProvider,
  CalendarEventInput,
  CalendarEventOutput,
} from '../calendar.types.js';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

import { randomUUID } from 'node:crypto';

interface GoogleApiEventResponse {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
      label?: string;
    }>;
    conferenceSolution?: {
      key?: { type?: string };
      name?: string;
      iconUri?: string;
    };
  };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
}

export class GoogleCalendarProvider implements ICalendarProvider {
  readonly name = 'google' as const;

  constructor(
    private readonly gService: GoogleService = googleService,
    private readonly gRepo: GoogleRepository = googleRepository,
  ) {}

  private async getAuthorizedToken(userId: string): Promise<string> {
    const connection = await this.gRepo.findByUserId(userId);
    if (!connection) {
      throw new NotFoundError('No connected Google account found for user', 'NO_GOOGLE_CONNECTION');
    }

    // Check if the user's connection granted the Calendar scope
    const hasCalendarScope = connection.scopes.some(
      (s) => s.includes('calendar') || s === GOOGLE_SCOPES.CALENDAR_EVENTS,
    );

    if (!hasCalendarScope) {
      throw new ForbiddenError(
        'Google Calendar permission not granted. Please reconnect your Google account to grant calendar access.',
        'GOOGLE_CALENDAR_SCOPE_MISSING',
      );
    }

    return this.gService.getValidAccessToken(userId);
  }

  private mapGoogleEvent(event: GoogleApiEventResponse): CalendarEventOutput {
    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : event.start?.date
        ? new Date(event.start.date)
        : new Date();

    const endTime = event.end?.dateTime
      ? new Date(event.end.dateTime)
      : event.end?.date
        ? new Date(event.end.date)
        : new Date(startTime.getTime() + 3600 * 1000);

    const videoEntryPoint = event.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === 'video',
    );
    const meetLink = event.hangoutLink || videoEntryPoint?.uri;
    const conferenceId = event.conferenceData?.conferenceId;

    return {
      id: event.id,
      title: event.summary || 'Untitled Event',
      description: event.description,
      startTime,
      endTime,
      location: event.location,
      htmlLink: event.htmlLink,
      status: event.status,
      attendees: event.attendees?.map((a) => a.email).filter((e): e is string => Boolean(e)),
      meetLink,
      conferenceId,
    };
  }

  async createEvent(userId: string, event: CalendarEventInput): Promise<CalendarEventOutput> {
    const token = await this.getAuthorizedToken(userId);

    const body: Record<string, unknown> = {
      summary: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start: {
        dateTime: new Date(event.startTime).toISOString(),
        timeZone: event.timeZone,
      },
      end: {
        dateTime: new Date(event.endTime).toISOString(),
        timeZone: event.timeZone,
      },
      attendees: event.attendees?.map((email) => ({ email })),
    };

    if (event.createMeet) {
      body['conferenceData'] = {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      };
    }

    const url = event.createMeet
      ? `${CALENDAR_API_BASE}?conferenceDataVersion=1`
      : CALENDAR_API_BASE;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText, userId, title: event.title },
        'Google Calendar event creation failed',
      );
      this.handleApiError(response.status, 'create event');
    }

    const data = (await response.json()) as GoogleApiEventResponse;
    logger.info(
      { eventId: data.id, userId, meetLink: data.hangoutLink },
      'Google Calendar event created successfully',
    );

    return this.mapGoogleEvent(data);
  }

  async updateEvent(
    userId: string,
    eventId: string,
    event: Partial<CalendarEventInput>,
  ): Promise<CalendarEventOutput> {
    const token = await this.getAuthorizedToken(userId);

    const body: {
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime: string; timeZone?: string };
      end?: { dateTime: string; timeZone?: string };
      attendees?: Array<{ email: string }>;
      conferenceData?: {
        createRequest: {
          requestId: string;
          conferenceSolutionKey: { type: string };
        };
      };
    } = {};

    if (event.title !== undefined) body.summary = event.title;
    if (event.description !== undefined) body.description = event.description ?? undefined;
    if (event.location !== undefined) body.location = event.location ?? undefined;
    if (event.startTime !== undefined) {
      body.start = {
        dateTime: new Date(event.startTime).toISOString(),
        timeZone: event.timeZone,
      };
    }
    if (event.endTime !== undefined) {
      body.end = {
        dateTime: new Date(event.endTime).toISOString(),
        timeZone: event.timeZone,
      };
    }
    if (event.attendees !== undefined) {
      body.attendees = event.attendees.map((email) => ({ email }));
    }
    if (event.createMeet) {
      body.conferenceData = {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      };
    }

    const url = event.createMeet
      ? `${CALENDAR_API_BASE}/${encodeURIComponent(eventId)}?conferenceDataVersion=1`
      : `${CALENDAR_API_BASE}/${encodeURIComponent(eventId)}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText, userId, eventId },
        'Google Calendar event update failed',
      );
      this.handleApiError(response.status, 'update event');
    }

    const data = (await response.json()) as GoogleApiEventResponse;
    logger.info({ eventId: data.id, userId }, 'Google Calendar event updated successfully');

    return this.mapGoogleEvent(data);
  }

  async deleteEvent(userId: string, eventId: string): Promise<void> {
    const token = await this.getAuthorizedToken(userId);

    const response = await fetch(`${CALENDAR_API_BASE}/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText, userId, eventId },
        'Google Calendar event deletion failed',
      );
      this.handleApiError(response.status, 'delete event');
    }

    logger.info({ eventId, userId }, 'Google Calendar event deleted successfully');
  }

  async getEvent(userId: string, eventId: string): Promise<CalendarEventOutput> {
    const token = await this.getAuthorizedToken(userId);

    const response = await fetch(`${CALENDAR_API_BASE}/${encodeURIComponent(eventId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText, userId, eventId },
        'Google Calendar get event failed',
      );
      this.handleApiError(response.status, 'get event');
    }

    const data = (await response.json()) as GoogleApiEventResponse;
    return this.mapGoogleEvent(data);
  }

  async listEvents(userId: string, timeMin?: Date, timeMax?: Date): Promise<CalendarEventOutput[]> {
    const token = await this.getAuthorizedToken(userId);

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    if (timeMin) params.set('timeMin', timeMin.toISOString());
    if (timeMax) params.set('timeMax', timeMax.toISOString());

    const response = await fetch(`${CALENDAR_API_BASE}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText, userId },
        'Google Calendar list events failed',
      );
      this.handleApiError(response.status, 'list events');
    }

    const data = (await response.json()) as { items?: GoogleApiEventResponse[] };
    return (data.items || []).map((item) => this.mapGoogleEvent(item));
  }

  private handleApiError(status: number, operation: string): never {
    if (status === 401) {
      throw new UnauthorizedError(
        'Google authentication expired or invalid. Please reconnect.',
        'GOOGLE_AUTH_INVALID',
      );
    }
    if (status === 403) {
      throw new ForbiddenError(
        'Google Calendar permission denied or quota exceeded.',
        'GOOGLE_CALENDAR_FORBIDDEN',
      );
    }
    if (status === 404 || status === 410) {
      throw new NotFoundError(
        'Google Calendar event not found or has been deleted',
        'GOOGLE_CALENDAR_EVENT_NOT_FOUND',
      );
    }
    if (status === 429) {
      throw new AppError('Google Calendar rate limit exceeded', 429, 'GOOGLE_CALENDAR_RATE_LIMIT');
    }
    throw new BadRequestError(
      `Google Calendar API ${operation} failed with HTTP ${status}`,
      'GOOGLE_CALENDAR_ERROR',
    );
  }
}

export const googleCalendarProvider = new GoogleCalendarProvider();
