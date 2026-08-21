export interface DashboardProjectsSummary {
  total: number;
  active: number;
}

export interface DashboardTasksSummary {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  overdue: number;
  assignedToMe: number;
}

export interface DashboardActivityUser {
  id: string;
  name: string;
  email: string;
}

export interface DashboardRecentActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
  user: DashboardActivityUser | null;
}

export interface DashboardRecentNotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface DashboardData {
  organizationId: string;
  projects: DashboardProjectsSummary;
  tasks: DashboardTasksSummary;
  recentActivity: DashboardRecentActivityItem[];
  recentNotifications: DashboardRecentNotificationItem[];
}

export interface GetDashboardOptions {
  organizationId: string;
  userId: string;
  recentActivityLimit?: number;
  recentNotificationsLimit?: number;
}
