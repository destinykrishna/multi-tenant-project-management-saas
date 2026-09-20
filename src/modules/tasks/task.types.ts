import type { TaskStatus, TaskPriority } from '../../constants/task.js';

export interface SafeUserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface SafeTeamSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface TaskResponse {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee?: SafeUserSummary | null;
  teamId?: string | null;
  team?: SafeTeamSummary | null;
  createdById: string;
  createdBy?: SafeUserSummary;
  dueDate: Date | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    comments: number;
  };
}
