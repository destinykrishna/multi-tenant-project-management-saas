export interface CalendarEventInput {
  title: string;
  description?: string | null;
  startTime: Date | string;
  endTime: Date | string;
  location?: string | null;
  attendees?: string[];
  timeZone?: string;
  createMeet?: boolean;
}

export interface CalendarEventOutput {
  id: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  htmlLink?: string;
  status?: string;
  attendees?: string[];
  meetLink?: string;
  conferenceId?: string;
}

export interface ICalendarProvider {
  readonly name: string;
  createEvent(userId: string, event: CalendarEventInput): Promise<CalendarEventOutput>;
  updateEvent(
    userId: string,
    eventId: string,
    event: Partial<CalendarEventInput>,
  ): Promise<CalendarEventOutput>;
  deleteEvent(userId: string, eventId: string): Promise<void>;
  getEvent(userId: string, eventId: string): Promise<CalendarEventOutput>;
  listEvents(userId: string, timeMin?: Date, timeMax?: Date): Promise<CalendarEventOutput[]>;
}
