export interface FormattedEntityOutput {
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

export function formatProjectContent(project: {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  description?: string | null;
  status: string;
  createdAt: Date;
  createdBy?: { name: string; email: string } | null;
}): FormattedEntityOutput {
  const parts = [
    `Project: ${project.name} (${project.key})`,
    `Status: ${project.status}`,
    project.description ? `Description: ${project.description}` : null,
    project.createdBy ? `Created By: ${project.createdBy.name}` : null,
  ].filter(Boolean);

  return {
    title: `Project: ${project.name} [${project.key}]`,
    content: parts.join('\n'),
    metadata: {
      projectId: project.id,
      key: project.key,
      status: project.status,
      name: project.name,
    },
  };
}

export function formatTaskContent(task: {
  id: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: Date | null;
  project?: { id?: string; name: string; key: string } | null;
  assignee?: { name: string; email: string } | null;
  createdBy?: { name: string; email: string } | null;
}): FormattedEntityOutput {
  const parts = [
    `Task: ${task.title}`,
    task.project ? `Project: ${task.project.name} (${task.project.key})` : null,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    task.dueDate ? `Due Date: ${task.dueDate.toISOString()}` : null,
    task.assignee ? `Assigned To: ${task.assignee.name}` : 'Unassigned',
    task.createdBy ? `Reporter: ${task.createdBy.name}` : null,
    task.description ? `Details:\n${task.description}` : null,
  ].filter(Boolean);

  return {
    title: `Task: ${task.title}`,
    content: parts.join('\n'),
    metadata: {
      taskId: task.id,
      projectId: task.projectId ?? task.project?.id,
      status: task.status,
      priority: task.priority,
      projectKey: task.project?.key,
    },
  };
}

export function formatCommentContent(comment: {
  id: string;
  content: string;
  createdAt: Date;
  user?: { name: string; email: string } | null;
  task?: {
    id: string;
    projectId?: string | null;
    title: string;
    project?: { id?: string; name: string; key: string } | null;
  } | null;
}): FormattedEntityOutput {
  const parts = [
    comment.task ? `Comment on Task: ${comment.task.title}` : 'Comment',
    comment.task?.project ? `Project: ${comment.task.project.name}` : null,
    comment.user ? `Author: ${comment.user.name}` : null,
    `Date: ${comment.createdAt.toISOString()}`,
    `Comment Body:\n${comment.content}`,
  ].filter(Boolean);

  return {
    title: `Comment by ${comment.user?.name ?? 'User'} on "${comment.task?.title ?? 'Task'}"`,
    content: parts.join('\n'),
    metadata: {
      commentId: comment.id,
      taskId: comment.task?.id,
      projectId: comment.task?.projectId ?? comment.task?.project?.id,
      authorName: comment.user?.name,
    },
  };
}

export function formatActivityLogContent(activity: {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: unknown;
  createdAt: Date;
  user?: { name: string; email: string } | null;
}): FormattedEntityOutput {
  const metaObj =
    activity.metadata && typeof activity.metadata === 'object'
      ? (activity.metadata as Record<string, unknown>)
      : {};

  const parts = [
    `Activity: ${activity.action} on ${activity.entityType}`,
    activity.user ? `User: ${activity.user.name}` : null,
    `Time: ${activity.createdAt.toISOString()}`,
    Object.keys(metaObj).length > 0 ? `Details: ${JSON.stringify(metaObj)}` : null,
  ].filter(Boolean);

  return {
    title: `Activity: ${activity.action} on ${activity.entityType}`,
    content: parts.join('\n'),
    metadata: {
      activityId: activity.id,
      entityType: activity.entityType,
      entityId: activity.entityId,
      action: activity.action,
      ...metaObj,
    },
  };
}
