export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';

export interface SafeProjectCreator {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface ProjectResponse {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  description: string | null;
  status: ProjectStatus;
  createdById: string;
  createdBy?: SafeProjectCreator;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    tasks: number;
  };
}
