import type { OrganizationRole } from '../../constants/roles.js';

export interface SafeMemberUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  createdAt: Date;
}

export interface OrganizationMemberResponse {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
  user: SafeMemberUser;
  isPending?: boolean;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  role?: OrganizationRole;
  _count?: {
    members: number;
    projects: number;
  };
}

export interface UserOrganizationListItem {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
}
