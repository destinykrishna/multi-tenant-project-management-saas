import { dashboardRepository, type DashboardRepository } from './dashboard.repository.js';
import type { DashboardData, GetDashboardOptions } from './dashboard.types.js';

export class DashboardService {
  constructor(private readonly repository: DashboardRepository = dashboardRepository) {}

  async getDashboardData(options: GetDashboardOptions): Promise<DashboardData> {
    const {
      organizationId,
      userId,
      recentActivityLimit = 5,
      recentNotificationsLimit = 5,
    } = options;

    const [projects, tasks, recentActivity, recentNotifications] = await Promise.all([
      this.repository.getProjectsMetrics(organizationId),
      this.repository.getTasksMetrics(organizationId, userId),
      this.repository.getRecentActivity(organizationId, recentActivityLimit),
      this.repository.getRecentNotifications(userId, recentNotificationsLimit),
    ]);

    return {
      organizationId,
      projects,
      tasks,
      recentActivity,
      recentNotifications,
    };
  }
}

export const dashboardService = new DashboardService();
