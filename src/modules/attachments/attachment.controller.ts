import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { BadRequestError, UnauthorizedError } from '../../utils/errors.js';
import { attachmentService, type AttachmentService } from './attachment.service.js';
import type { ListAttachmentsQuery } from './attachment.schema.js';
import { getSafeDownloadContentType } from './attachment.storage.js';

export class AttachmentController {
  constructor(private readonly service: AttachmentService = attachmentService) {}

  upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      if (!req.file) {
        throw new BadRequestError('File is required for upload', 'FILE_REQUIRED');
      }

      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const userId = req.user.id;

      const result = await this.service.uploadAttachment(
        organizationId,
        projectId,
        taskId,
        userId,
        req.file,
      );

      sendSuccess(res, result, 201, 'Attachment uploaded successfully');
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const query = req.query as unknown as ListAttachmentsQuery;

      const result = await this.service.getAttachments(organizationId, projectId, taskId, query);

      sendSuccess(res, result, 200, 'Attachments retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  download = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const attachmentId = req.params['attachmentId'] as string;

      const { filePath, originalName, mimeType } = await this.service.downloadAttachment(
        organizationId,
        projectId,
        taskId,
        attachmentId,
      );

      const safeContentType = getSafeDownloadContentType(originalName, mimeType);
      const safeFilename = originalName.replace(/["\r\n\\]/g, '_');

      // Secure download headers: force attachment, prevent MIME sniffing, and isolate with strict sandbox CSP
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Type', safeContentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

      res.download(filePath, originalName, {
        headers: {
          'Content-Disposition': `attachment; filename="${safeFilename}"`,
          'Content-Type': safeContentType,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const attachmentId = req.params['attachmentId'] as string;
      const userId = req.user.id;
      const role = req.membership?.role ?? '';

      await this.service.deleteAttachment(
        organizationId,
        projectId,
        taskId,
        attachmentId,
        userId,
        role,
      );

      sendSuccess(res, null, 200, 'Attachment deleted successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const attachmentController = new AttachmentController();
