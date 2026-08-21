import type { Prisma } from '../../generated/prisma/client.js';
import type { EntityType, ActivityAction } from '../../constants/activity.js';

export interface LogActivityParams {
  organizationId: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  action: ActivityAction;
  metadata?: Prisma.InputJsonValue;
}

export interface SafeActivityUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface ActivityLogResponse {
  id: string;
  organizationId: string;
  userId: string;
  user: SafeActivityUser;
  entityType: EntityType;
  entityId: string;
  action: ActivityAction;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}
