import fs from 'node:fs';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import {
  getPaginationOffset,
  buildPaginatedResponse,
  type PaginatedResponse,
} from '../../utils/pagination.js';
import { OrganizationRole } from '../../constants/roles.js';
import { attachmentRepository, type AttachmentRepository } from './attachment.repository.js';
import {
  saveAttachmentToDisk,
  deleteAttachmentFromDisk,
  getSafeFilePath,
} from './attachment.storage.js';
import { activityService, type ActivityService } from '../activity/activity.service.js';
import { EntityType, ActivityAction } from '../../constants/activity.js';
import type { ListAttachmentsQuery } from './attachment.schema.js';
import type { AttachmentResponse } from './attachment.types.js';

export class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository = attachmentRepository,
    private readonly activity: ActivityService = activityService,
  ) {}

  private async validateTaskInOrg(organizationId: string, projectId: string, taskId: string) {
    const task = await this.repository.findTaskInOrg(organizationId, projectId, taskId);
    if (!task) {
      throw new NotFoundError('Task not found in this organization and project', 'TASK_NOT_FOUND');
    }
    return task;
  }

  async uploadAttachment(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<AttachmentResponse> {
    await this.validateTaskInOrg(organizationId, projectId, taskId);

    // Save file to local storage securely
    const { storageKey, size } = await saveAttachmentToDisk(file);

    const attachment = await this.repository.createAttachment({
      taskId,
      uploadedById: userId,
      originalName: file.originalname || 'attachment',
      storageKey,
      mimeType: file.mimetype || 'application/octet-stream',
      size,
    });

    await this.activity.logActivity({
      organizationId,
      userId,
      entityType: EntityType.TASK,
      entityId: taskId,
      action: ActivityAction.UPDATED,
      metadata: {
        action: 'ATTACHMENT_UPLOADED',
        attachmentId: attachment.id,
        originalName: attachment.originalName,
        size: attachment.size,
      },
    });

    return {
      id: attachment.id,
      taskId: attachment.taskId,
      uploadedById: attachment.uploadedById,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      uploadedBy: attachment.uploadedBy,
    };
  }

  async getAttachments(
    organizationId: string,
    projectId: string,
    taskId: string,
    query: ListAttachmentsQuery,
  ): Promise<PaginatedResponse<AttachmentResponse>> {
    await this.validateTaskInOrg(organizationId, projectId, taskId);

    const { page, limit, skip, take } = getPaginationOffset(query.page, query.limit);

    const { items, total } = await this.repository.findPaginatedAttachments(taskId, {
      skip,
      take,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    const mapped: AttachmentResponse[] = items.map((a) => ({
      id: a.id,
      taskId: a.taskId,
      uploadedById: a.uploadedById,
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
      uploadedBy: a.uploadedBy,
    }));

    return buildPaginatedResponse(mapped, total, page, limit);
  }

  async downloadAttachment(
    organizationId: string,
    projectId: string,
    taskId: string,
    attachmentId: string,
  ): Promise<{ filePath: string; originalName: string; mimeType: string; size: number }> {
    await this.validateTaskInOrg(organizationId, projectId, taskId);

    const attachment = await this.repository.findAttachmentById(taskId, attachmentId);
    if (!attachment) {
      throw new NotFoundError('Attachment not found in this task', 'ATTACHMENT_NOT_FOUND');
    }

    const filePath = getSafeFilePath(attachment.storageKey);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundError(
        'Physical attachment file not found on disk',
        'FILE_NOT_FOUND_ON_DISK',
      );
    }

    return {
      filePath,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    };
  }

  async deleteAttachment(
    organizationId: string,
    projectId: string,
    taskId: string,
    attachmentId: string,
    userId: string,
    role: string,
  ): Promise<void> {
    await this.validateTaskInOrg(organizationId, projectId, taskId);

    const attachment = await this.repository.findAttachmentById(taskId, attachmentId);
    if (!attachment) {
      throw new NotFoundError('Attachment not found in this task', 'ATTACHMENT_NOT_FOUND');
    }

    const isAuthor = attachment.uploadedById === userId;
    const isModerator = role === OrganizationRole.OWNER || role === OrganizationRole.ADMIN;

    if (!isAuthor && !isModerator) {
      throw new ForbiddenError(
        'Insufficient permissions to delete this attachment',
        'INSUFFICIENT_PERMISSIONS',
      );
    }

    // Delete DB record
    await this.repository.deleteAttachment(attachmentId);

    // Safely delete physical file on disk
    await deleteAttachmentFromDisk(attachment.storageKey);

    await this.activity.logActivity({
      organizationId,
      userId,
      entityType: EntityType.TASK,
      entityId: taskId,
      action: ActivityAction.UPDATED,
      metadata: {
        action: 'ATTACHMENT_DELETED',
        attachmentId,
        originalName: attachment.originalName,
      },
    });
  }
}

export const attachmentService = new AttachmentService();
