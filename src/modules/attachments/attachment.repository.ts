import { prisma } from '../../config/database.js';

export interface CreateAttachmentData {
  taskId: string;
  uploadedById: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  size: number;
}

export interface FindAttachmentsOptions {
  skip: number;
  take: number;
  sortBy?: 'createdAt' | 'size' | 'originalName';
  sortOrder?: 'asc' | 'desc';
}

export class AttachmentRepository {
  async findTaskInOrg(organizationId: string, projectId: string, taskId: string) {
    return prisma.task.findFirst({
      where: {
        id: taskId,
        projectId,
        project: { organizationId },
      },
      include: {
        project: {
          select: { id: true, organizationId: true },
        },
      },
    });
  }

  async createAttachment(data: CreateAttachmentData) {
    return prisma.attachment.create({
      data: {
        taskId: data.taskId,
        uploadedById: data.uploadedById,
        originalName: data.originalName,
        storageKey: data.storageKey,
        mimeType: data.mimeType,
        size: data.size,
      },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async findAttachmentById(taskId: string, attachmentId: string) {
    return prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        taskId,
      },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async findPaginatedAttachments(taskId: string, options: FindAttachmentsOptions) {
    const orderBy: Record<string, 'asc' | 'desc'> = {};
    const sortField = options.sortBy || 'createdAt';
    orderBy[sortField] = options.sortOrder || 'desc';

    const [items, total] = await Promise.all([
      prisma.attachment.findMany({
        where: { taskId },
        skip: options.skip,
        take: options.take,
        orderBy,
        include: {
          uploadedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      prisma.attachment.count({
        where: { taskId },
      }),
    ]);

    return { items, total };
  }

  async deleteAttachment(attachmentId: string) {
    return prisma.attachment.delete({
      where: { id: attachmentId },
    });
  }
}

export const attachmentRepository = new AttachmentRepository();
