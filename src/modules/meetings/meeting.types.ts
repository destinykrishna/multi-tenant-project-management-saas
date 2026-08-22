export interface CreateMeetingInput {
  title: string;
  description?: string | null;
  startTime: Date | string;
  endTime: Date | string;
  location?: string | null;
  projectId?: string;
  taskId?: string;
  syncWithGoogle?: boolean;
  createGoogleMeet?: boolean;
}

export interface UpdateMeetingInput {
  title?: string;
  description?: string | null;
  startTime?: Date | string;
  endTime?: Date | string;
  location?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  syncWithGoogle?: boolean;
  createGoogleMeet?: boolean;
}

export interface MeetingResponse {
  id: string;
  organizationId: string;
  projectId: string | null;
  taskId: string | null;
  createdById: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  googleEventId: string | null;
  googleCalendarId: string | null;
  googleHtmlLink: string | null;
  googleSyncedAt: Date | null;
  googleMeetLink: string | null;
  googleMeetId: string | null;
  isMeetEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  };
  project?: {
    id: string;
    name: string;
    key: string;
  } | null;
}
