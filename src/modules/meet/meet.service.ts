import { googleMeetProvider } from './providers/google-meet.provider.js';
import type { IMeetProvider, CreateMeetOptions, GoogleMeetConferenceOutput } from './meet.types.js';

export class GoogleMeetService {
  constructor(private readonly provider: IMeetProvider = googleMeetProvider) {}

  async createConference(
    userId: string,
    options: CreateMeetOptions,
  ): Promise<GoogleMeetConferenceOutput> {
    return this.provider.createConference(userId, options);
  }

  async getConference(userId: string, eventId: string): Promise<GoogleMeetConferenceOutput | null> {
    return this.provider.getConference(userId, eventId);
  }
}

export const googleMeetService = new GoogleMeetService();
