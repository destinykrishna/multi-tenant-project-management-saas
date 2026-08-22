import { prisma } from '../../config/database.js';

export interface CreateMeetingRepoData {
  organizationId: string;
  projectId?: string | null;
  taskId?: string | null;
  createdById: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  googleHtmlLink?: string | null;
  googleSyncedAt?: Date | null;
  googleMeetLink?: string | null;
  googleMeetId?: string | null;
  isMeetEnabled?: boolean;
}

export interface UpdateMeetingRepoData {
  title?: string;
  description?: string | null;
  startTime?: Date;
  endTime?: Date;
  location?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  googleHtmlLink?: string | null;
  googleSyncedAt?: Date | null;
  googleMeetLink?: string | null;
  googleMeetId?: string | null;
  isMeetEnabled?: boolean;
}

export interface FindMeetingsFilter {
  projectId?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

export class MeetingRepository {
  async create(data: CreateMeetingRepoData) {
    return prisma.meeting.create({
      data: {
        organizationId: data.organizationId,
        projectId: data.projectId,
        taskId: data.taskId,
        createdById: data.createdById,
        title: data.title,
        description: data.description,
        startTime: data.startTime,
        endTime: data.endTime,
        location: data.location,
        googleEventId: data.googleEventId,
        googleCalendarId: data.googleCalendarId ?? 'primary',
        googleHtmlLink: data.googleHtmlLink,
        googleSyncedAt: data.googleSyncedAt,
        googleMeetLink: data.googleMeetLink,
        googleMeetId: data.googleMeetId,
        isMeetEnabled: data.isMeetEnabled ?? false,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, name: true, key: true },
        },
      },
    });
  }

  async findById(organizationId: string, id: string) {
    return prisma.meeting.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, name: true, key: true },
        },
      },
    });
  }

  async findByOrganization(organizationId: string, filter: FindMeetingsFilter = {}) {
    const startTimeFilter: { gte?: Date; lte?: Date } = {};
    if (filter.from) startTimeFilter.gte = filter.from;
    if (filter.to) startTimeFilter.lte = filter.to;

    const where = {
      organizationId,
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.from || filter.to ? { startTime: startTimeFilter } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: { startTime: 'asc' },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          project: {
            select: { id: true, name: true, key: true },
          },
        },
      }),
      prisma.meeting.count({ where }),
    ]);

    return { items, total };
  }

  async update(organizationId: string, id: string, data: UpdateMeetingRepoData) {
    return prisma.meeting.update({
      where: {
        id,
        organizationId,
      },
      data,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, name: true, key: true },
        },
      },
    });
  }

  async delete(organizationId: string, id: string) {
    return prisma.meeting.delete({
      where: {
        id,
        organizationId,
      },
    });
  }
}

export const meetingRepository = new MeetingRepository();
