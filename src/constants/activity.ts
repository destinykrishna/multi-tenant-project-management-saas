export const EntityType = {
  ORGANIZATION: 'ORGANIZATION',
  PROJECT: 'PROJECT',
  TASK: 'TASK',
  COMMENT: 'COMMENT',
  USER: 'USER',
  MEETING: 'MEETING',
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export const ActivityAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEET_LINK_CREATED: 'MEET_LINK_CREATED',
} as const;

export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction];
