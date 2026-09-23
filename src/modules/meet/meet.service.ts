import { calendarService, type CalendarService } from '../calendar/calendar.service.js';
import type { IMeetProvider, CreateMeetOptions, GoogleMeetConferenceOutput } from './meet.types.js';

export class GoogleMeetService implements IMeetProvider {
  readonly name = 'google' as const;

  constructor(private readonly calService: CalendarService = calendarService) {}

  async createConference(
    userId: string,
    options: CreateMeetOptions,
  ): Promise<GoogleMeetConferenceOutput> {
    const event = await this.calService.createEvent(userId, {
      title: options.title,
      description: options.description,
      startTime: options.startTime,
      endTime: options.endTime,
      location: options.location,
      attendees: options.attendees,
      createMeet: true,
    });

    const meetLink = event.meetLink || event.htmlLink || `https://meet.google.com/${event.id}`;
    const conferenceId = event.conferenceId || event.id;

    return {
      meetLink,
      conferenceId,
      calendarEventId: event.id,
      htmlLink: event.htmlLink,
      entryPoints: [
        {
          entryPointType: 'video',
          uri: meetLink,
          label: meetLink.replace(/^https?:\/\//, ''),
        },
      ],
      conferenceSolution: {
        name: 'Google Meet',
      },
    };
  }

  async getConference(userId: string, eventId: string): Promise<GoogleMeetConferenceOutput | null> {
    const event = await this.calService.getEvent(userId, eventId);

    const meetLink = event.meetLink || event.htmlLink || `https://meet.google.com/${event.id}`;
    const conferenceId = event.conferenceId || event.id;

    return {
      meetLink,
      conferenceId,
      calendarEventId: event.id,
      htmlLink: event.htmlLink,
      entryPoints: [
        {
          entryPointType: 'video',
          uri: meetLink,
          label: meetLink.replace(/^https?:\/\//, ''),
        },
      ],
      conferenceSolution: {
        name: 'Google Meet',
      },
    };
  }
}

export const googleMeetService = new GoogleMeetService();
