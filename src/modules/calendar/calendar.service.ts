import { googleCalendarProvider } from './providers/google-calendar.provider.js';
import type {
  ICalendarProvider,
  CalendarEventInput,
  CalendarEventOutput,
} from './calendar.types.js';

export class CalendarService {
  constructor(private readonly provider: ICalendarProvider = googleCalendarProvider) {}

  async createEvent(userId: string, event: CalendarEventInput): Promise<CalendarEventOutput> {
    return this.provider.createEvent(userId, event);
  }

  async updateEvent(
    userId: string,
    eventId: string,
    event: Partial<CalendarEventInput>,
  ): Promise<CalendarEventOutput> {
    return this.provider.updateEvent(userId, eventId, event);
  }

  async deleteEvent(userId: string, eventId: string): Promise<void> {
    return this.provider.deleteEvent(userId, eventId);
  }

  async getEvent(userId: string, eventId: string): Promise<CalendarEventOutput> {
    return this.provider.getEvent(userId, eventId);
  }

  async listEvents(userId: string, timeMin?: Date, timeMax?: Date): Promise<CalendarEventOutput[]> {
    return this.provider.listEvents(userId, timeMin, timeMax);
  }
}

export const calendarService = new CalendarService();
