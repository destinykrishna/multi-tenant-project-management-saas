export interface CreateMeetOptions {
  title: string;
  startTime: Date | string;
  endTime: Date | string;
  description?: string | null;
  location?: string | null;
  attendees?: string[];
}

export interface GoogleMeetConferenceOutput {
  meetLink: string;
  conferenceId: string;
  calendarEventId?: string;
  htmlLink?: string;
  entryPoints?: Array<{
    uri: string;
    label?: string;
    entryPointType?: string;
  }>;
  conferenceSolution?: {
    name?: string;
    iconUri?: string;
  };
}

export interface IMeetProvider {
  readonly name: string;
  createConference(userId: string, options: CreateMeetOptions): Promise<GoogleMeetConferenceOutput>;
  getConference(userId: string, eventId: string): Promise<GoogleMeetConferenceOutput | null>;
}
