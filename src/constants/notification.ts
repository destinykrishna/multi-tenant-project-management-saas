export const NotificationType = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  PROJECT_UPDATED: 'PROJECT_UPDATED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  GENERAL: 'GENERAL',
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
