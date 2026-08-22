import { logger } from '../../config/logger.js';
import { NotFoundError } from '../../utils/errors.js';
import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import { activityService, type ActivityService } from '../activity/activity.service.js';
import { calendarService, type CalendarService } from '../calendar/calendar.service.js';
import { projectRepository, type ProjectRepository } from '../projects/project.repository.js';
import { meetingRepository, type MeetingRepository } from './meeting.repository.js';
import type { CreateMeetingInput, UpdateMeetingInput, MeetingResponse } from './meeting.types.js';
import type { ListMeetingsQuery } from './meeting.schema.js';

export class MeetingService {
  constructor(
    private readonly repo: MeetingRepository = meetingRepository,
    private readonly projectRepo: ProjectRepository = projectRepository,
    private readonly calService: CalendarService = calendarService,
    private readonly actService: ActivityService = activityService,
  ) {}

  async createMeeting(
    organizationId: string,
    userId: string,
    input: CreateMeetingInput,
  ): Promise<MeetingResponse> {
    // 1. Validate project tenancy if specified
    if (input.projectId) {
      const project = await this.projectRepo.findById(organizationId, input.projectId);
      if (!project) {
        throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
      }
    }

    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);

    let googleEventId: string | null = null;
    let googleHtmlLink: string | null = null;
    let googleSyncedAt: Date | null = null;
    let googleMeetLink: string | null = null;
    let googleMeetId: string | null = null;
    let isMeetEnabled = false;

    // 2. Sync with Google Calendar / Meet OUTSIDE database transactions if requested
    if (input.syncWithGoogle || input.createGoogleMeet) {
      try {
        const calEvent = await this.calService.createEvent(userId, {
          title: input.title,
          description: input.description,
          startTime,
          endTime,
          location: input.location,
          createMeet: input.createGoogleMeet ?? false,
        });

        googleEventId = calEvent.id;
        googleHtmlLink = calEvent.htmlLink ?? null;
        googleSyncedAt = new Date();
        googleMeetLink = calEvent.meetLink ?? null;
        googleMeetId = calEvent.conferenceId ?? null;
        isMeetEnabled = Boolean(calEvent.meetLink);
      } catch (err) {
        logger.warn(
          { err, userId, title: input.title },
          'Failed to sync new meeting to Google Calendar/Meet, proceeding with DB creation',
        );
        throw err;
      }
    }

    // 3. Persist Meeting in PostgreSQL (Source of Truth)
    const meeting = await this.repo.create({
      organizationId,
      projectId: input.projectId,
      taskId: input.taskId,
      createdById: userId,
      title: input.title,
      description: input.description,
      startTime,
      endTime,
      location: input.location,
      googleEventId,
      googleHtmlLink,
      googleSyncedAt,
      googleMeetLink,
      googleMeetId,
      isMeetEnabled,
    });

    // 4. Log audit activity asynchronously
    try {
      await this.actService.logActivity({
        organizationId,
        userId,
        entityType: 'MEETING',
        entityId: meeting.id,
        action: 'CREATED',
        metadata: {
          title: meeting.title,
          startTime: meeting.startTime.toISOString(),
          endTime: meeting.endTime.toISOString(),
          googleSynced: Boolean(googleEventId),
          googleMeetLink,
          isMeetEnabled,
        },
      });

      if (isMeetEnabled && googleMeetLink) {
        await this.actService.logActivity({
          organizationId,
          userId,
          entityType: 'MEETING',
          entityId: meeting.id,
          action: 'MEET_LINK_CREATED',
          metadata: {
            title: meeting.title,
            googleMeetLink,
            googleMeetId,
          },
        });
      }
    } catch (actErr) {
      logger.warn({ actErr, meetingId: meeting.id }, 'Failed to log meeting creation activity');
    }

    return meeting;
  }

  async getMeetings(
    organizationId: string,
    query: ListMeetingsQuery,
  ): Promise<PaginatedResponse<MeetingResponse>> {
    const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

    const { items, total } = await this.repo.findByOrganization(organizationId, {
      projectId: query.projectId,
      from: query.from,
      to: query.to,
      skip,
      take,
    });

    return buildPaginatedResponse(items, total, page, limit);
  }

  async getMeetingById(organizationId: string, meetingId: string): Promise<MeetingResponse> {
    const meeting = await this.repo.findById(organizationId, meetingId);

    if (!meeting) {
      throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
    }

    return meeting;
  }

  async updateMeeting(
    organizationId: string,
    userId: string,
    meetingId: string,
    input: UpdateMeetingInput,
  ): Promise<MeetingResponse> {
    const existing = await this.repo.findById(organizationId, meetingId);

    if (!existing) {
      throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
    }

    if (input.projectId) {
      const project = await this.projectRepo.findById(organizationId, input.projectId);
      if (!project) {
        throw new NotFoundError('Project not found in this organization', 'PROJECT_NOT_FOUND');
      }
    }

    const startTime = input.startTime ? new Date(input.startTime) : existing.startTime;
    const endTime = input.endTime ? new Date(input.endTime) : existing.endTime;

    let googleEventId = existing.googleEventId;
    let googleHtmlLink = existing.googleHtmlLink;
    let googleSyncedAt = existing.googleSyncedAt;
    let googleMeetLink = existing.googleMeetLink;
    let googleMeetId = existing.googleMeetId;
    let isMeetEnabled = existing.isMeetEnabled;

    // Sync updates with Google Calendar OUTSIDE database transactions
    if (existing.googleEventId) {
      try {
        const updatedEvent = await this.calService.updateEvent(userId, existing.googleEventId, {
          title: input.title ?? existing.title,
          description:
            input.description !== undefined
              ? (input.description ?? undefined)
              : (existing.description ?? undefined),
          location:
            input.location !== undefined
              ? (input.location ?? undefined)
              : (existing.location ?? undefined),
          startTime,
          endTime,
          createMeet: input.createGoogleMeet ?? false,
        });

        googleHtmlLink = updatedEvent.htmlLink ?? googleHtmlLink;
        googleSyncedAt = new Date();
        if (updatedEvent.meetLink) {
          googleMeetLink = updatedEvent.meetLink;
          googleMeetId = updatedEvent.conferenceId ?? googleMeetId;
          isMeetEnabled = true;
        }
      } catch (err) {
        logger.warn(
          { err, meetingId, eventId: existing.googleEventId },
          'Failed to update Google Calendar event',
        );
        throw err;
      }
    } else if (input.syncWithGoogle || input.createGoogleMeet) {
      try {
        const newEvent = await this.calService.createEvent(userId, {
          title: input.title ?? existing.title,
          description: input.description ?? existing.description ?? undefined,
          location: input.location ?? existing.location ?? undefined,
          startTime,
          endTime,
          createMeet: input.createGoogleMeet ?? false,
        });

        googleEventId = newEvent.id;
        googleHtmlLink = newEvent.htmlLink ?? null;
        googleSyncedAt = new Date();
        googleMeetLink = newEvent.meetLink ?? null;
        googleMeetId = newEvent.conferenceId ?? null;
        isMeetEnabled = Boolean(newEvent.meetLink);
      } catch (err) {
        logger.warn({ err, meetingId }, 'Failed to sync meeting to Google Calendar');
        throw err;
      }
    }

    const updated = await this.repo.update(organizationId, meetingId, {
      title: input.title,
      description: input.description,
      startTime: input.startTime ? new Date(input.startTime) : undefined,
      endTime: input.endTime ? new Date(input.endTime) : undefined,
      location: input.location,
      projectId: input.projectId,
      taskId: input.taskId,
      googleEventId,
      googleHtmlLink,
      googleSyncedAt,
      googleMeetLink,
      googleMeetId,
      isMeetEnabled,
    });

    try {
      await this.actService.logActivity({
        organizationId,
        userId,
        entityType: 'MEETING',
        entityId: updated.id,
        action: 'UPDATED',
        metadata: {
          title: updated.title,
          updatedFields: Object.keys(input),
          googleMeetLink,
        },
      });
    } catch (actErr) {
      logger.warn({ actErr, meetingId }, 'Failed to log meeting update activity');
    }

    return updated;
  }

  async generateMeetLink(
    organizationId: string,
    userId: string,
    meetingId: string,
  ): Promise<MeetingResponse> {
    const existing = await this.repo.findById(organizationId, meetingId);

    if (!existing) {
      throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
    }

    let googleEventId = existing.googleEventId;
    let googleHtmlLink = existing.googleHtmlLink;
    const googleSyncedAt = new Date();
    let googleMeetLink: string;
    let googleMeetId: string;

    if (existing.googleEventId) {
      const updatedEvent = await this.calService.updateEvent(userId, existing.googleEventId, {
        title: existing.title,
        startTime: existing.startTime,
        endTime: existing.endTime,
        createMeet: true,
      });

      googleHtmlLink = updatedEvent.htmlLink ?? googleHtmlLink;
      googleMeetLink = updatedEvent.meetLink ?? `https://meet.google.com/${updatedEvent.id}`;
      googleMeetId = updatedEvent.conferenceId ?? updatedEvent.id;
    } else {
      const newEvent = await this.calService.createEvent(userId, {
        title: existing.title,
        description: existing.description,
        startTime: existing.startTime,
        endTime: existing.endTime,
        location: existing.location,
        createMeet: true,
      });

      googleEventId = newEvent.id;
      googleHtmlLink = newEvent.htmlLink ?? null;
      googleMeetLink = newEvent.meetLink ?? `https://meet.google.com/${newEvent.id}`;
      googleMeetId = newEvent.conferenceId ?? newEvent.id;
    }

    const updated = await this.repo.update(organizationId, meetingId, {
      googleEventId,
      googleHtmlLink,
      googleSyncedAt,
      googleMeetLink,
      googleMeetId,
      isMeetEnabled: true,
    });

    try {
      await this.actService.logActivity({
        organizationId,
        userId,
        entityType: 'MEETING',
        entityId: updated.id,
        action: 'MEET_LINK_CREATED',
        metadata: {
          title: updated.title,
          googleMeetLink,
          googleMeetId,
        },
      });
    } catch (actErr) {
      logger.warn({ actErr, meetingId }, 'Failed to log meet link creation activity');
    }

    return updated;
  }

  async deleteMeeting(
    organizationId: string,
    userId: string,
    meetingId: string,
  ): Promise<{ deleted: boolean }> {
    const existing = await this.repo.findById(organizationId, meetingId);

    if (!existing) {
      throw new NotFoundError('Meeting not found', 'MEETING_NOT_FOUND');
    }

    // Delete from Google Calendar OUTSIDE database transactions if synced
    if (existing.googleEventId) {
      try {
        await this.calService.deleteEvent(userId, existing.googleEventId);
      } catch (err) {
        logger.warn(
          { err, eventId: existing.googleEventId },
          'Failed to delete event from Google Calendar',
        );
      }
    }

    await this.repo.delete(organizationId, meetingId);

    try {
      await this.actService.logActivity({
        organizationId,
        userId,
        entityType: 'MEETING',
        entityId: meetingId,
        action: 'DELETED',
        metadata: {
          title: existing.title,
          googleEventId: existing.googleEventId,
        },
      });
    } catch (actErr) {
      logger.warn({ actErr, meetingId }, 'Failed to log meeting deletion activity');
    }

    return { deleted: true };
  }
}

export const meetingService = new MeetingService();
