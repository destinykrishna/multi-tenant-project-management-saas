import { prisma } from '../../config/database.js';
import { TaskStatus, TaskPriority } from '../../constants/task.js';
import type {
  DashboardProjectsSummary,
  DashboardTasksSummary,
  DashboardRecentActivityItem,
  DashboardRecentNotificationItem,
} from './dashboard.types.js';

export class DashboardRepository {
  async getProjectsMetrics(organizationId: string): Promise<DashboardProjectsSummary> {
    const [total, active] = await Promise.all([
      prisma.project.count({
        where: { organizationId },
      }),
      prisma.project.count({
        where: { organizationId, status: 'ACTIVE' },
      }),
    ]);

    return { total, active };
  }

  async getTasksMetrics(organizationId: string, userId: string): Promise<DashboardTasksSummary> {
    const now = new Date();

    const [total, statusGroups, priorityGroups, overdue, assignedToMe] = await Promise.all([
      prisma.task.count({
        where: { project: { organizationId } },
      }),
      prisma.task.groupBy({
        by: ['status'],
        where: { project: { organizationId } },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['priority'],
        where: { project: { organizationId } },
        _count: { id: true },
      }),
      prisma.task.count({
        where: {
          project: { organizationId },
          status: { notIn: ['DONE', 'CANCELLED'] },
          dueDate: { lt: now },
        },
      }),
      prisma.task.count({
        where: {
          project: { organizationId },
          assigneeId: userId,
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
      }),
    ]);

    // Build default complete maps
    const byStatus: Record<string, number> = Object.values(TaskStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {},
    );
    for (const group of statusGroups) {
      byStatus[group.status] = group._count.id;
    }

    const byPriority: Record<string, number> = Object.values(TaskPriority).reduce(
      (acc, p) => ({ ...acc, [p]: 0 }),
      {},
    );
    for (const group of priorityGroups) {
      byPriority[group.priority] = group._count.id;
    }

    return {
      total,
      byStatus,
      byPriority,
      overdue,
      assignedToMe,
    };
  }

  async getRecentActivity(
    organizationId: string,
    limit = 5,
  ): Promise<DashboardRecentActivityItem[]> {
    const logs = await prisma.activityLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      createdAt: log.createdAt,
      user: log.user,
    }));
  }

  async getRecentNotifications(
    userId: string,
    limit = 5,
  ): Promise<DashboardRecentNotificationItem[]> {
    const notifs = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return notifs.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: n.isRead,
      readAt: n.readAt,
      createdAt: n.createdAt,
    }));
  }
}

export const dashboardRepository = new DashboardRepository();
