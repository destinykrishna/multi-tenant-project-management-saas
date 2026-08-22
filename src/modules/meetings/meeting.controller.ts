import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { meetingService, type MeetingService } from './meeting.service.js';
import type {
  CreateMeetingSchemaInput,
  UpdateMeetingSchemaInput,
  ListMeetingsQuery,
} from './meeting.schema.js';

export class MeetingController {
  constructor(private readonly service: MeetingService = meetingService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const body = req.body as CreateMeetingSchemaInput;
    const meeting = await this.service.createMeeting(
      req.membership.organizationId,
      req.user.id,
      body,
    );

    sendSuccess(res, meeting, 201, 'Meeting created successfully');
  };

  list = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership?.organizationId) {
      throw new UnauthorizedError('Organization membership required');
    }

    const query = req.query as unknown as ListMeetingsQuery;
    const result = await this.service.getMeetings(req.membership.organizationId, query);

    sendSuccess(res, result, 200, 'Meetings retrieved successfully');
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership?.organizationId) {
      throw new UnauthorizedError('Organization membership required');
    }

    const meetingId = req.params['meetingId'] as string;
    const meeting = await this.service.getMeetingById(req.membership.organizationId, meetingId);

    sendSuccess(res, meeting, 200, 'Meeting retrieved successfully');
  };

  update = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const meetingId = req.params['meetingId'] as string;
    const body = req.body as UpdateMeetingSchemaInput;
    const meeting = await this.service.updateMeeting(
      req.membership.organizationId,
      req.user.id,
      meetingId,
      body,
    );

    sendSuccess(res, meeting, 200, 'Meeting updated successfully');
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const meetingId = req.params['meetingId'] as string;
    const result = await this.service.deleteMeeting(
      req.membership.organizationId,
      req.user.id,
      meetingId,
    );

    sendSuccess(res, result, 200, 'Meeting deleted successfully');
  };

  generateMeetLink = async (req: Request, res: Response): Promise<void> => {
    if (!req.user?.id || !req.membership?.organizationId) {
      throw new UnauthorizedError('Authentication and organization membership required');
    }

    const meetingId = req.params['meetingId'] as string;
    const result = await this.service.generateMeetLink(
      req.membership.organizationId,
      req.user.id,
      meetingId,
    );

    sendSuccess(res, result, 200, 'Google Meet link generated and attached successfully');
  };
}

export const meetingController = new MeetingController();
