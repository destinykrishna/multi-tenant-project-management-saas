import { z } from 'zod';
import { TaskStatus, TaskPriority } from '../../constants/task.js';

export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Task title is required')
    .max(255, 'Title cannot exceed 255 characters'),
  description: z
    .string()
    .trim()
    .max(5000, 'Description cannot exceed 5000 characters')
    .nullable()
    .optional(),
  status: z
    .enum([
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.IN_REVIEW,
      TaskStatus.DONE,
      TaskStatus.CANCELLED,
    ])
    .default(TaskStatus.TODO),
  priority: z
    .enum([TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT])
    .default(TaskPriority.MEDIUM),
  assigneeId: z.uuid('Invalid assignee ID format').nullable().optional(),
  assigneeUserIds: z.array(z.uuid('Invalid assignee ID format')).optional(),
  teamId: z.uuid('Invalid team ID format').nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  position: z.number().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Task title is required')
      .max(255, 'Title cannot exceed 255 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(5000, 'Description cannot exceed 5000 characters')
      .nullable()
      .optional(),
    status: z
      .enum([
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW,
        TaskStatus.DONE,
        TaskStatus.CANCELLED,
      ])
      .optional(),
    priority: z
      .enum([TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT])
      .optional(),
    assigneeId: z.uuid('Invalid assignee ID format').nullable().optional(),
    assigneeUserIds: z.array(z.uuid('Invalid assignee ID format')).optional(),
    teamId: z.uuid('Invalid team ID format').nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    position: z.number().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.status !== undefined ||
      data.priority !== undefined ||
      data.assigneeId !== undefined ||
      data.assigneeUserIds !== undefined ||
      data.teamId !== undefined ||
      data.dueDate !== undefined ||
      data.position !== undefined,
    {
      message: 'At least one field must be provided for update',
    },
  );

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskProjectParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  projectId: z.uuid('Invalid project ID format'),
});

export type TaskProjectParam = z.infer<typeof taskProjectParamSchema>;

export const taskParamSchema = z.object({
  organizationId: z.uuid('Invalid organization ID format'),
  projectId: z.uuid('Invalid project ID format'),
  taskId: z.uuid('Invalid task ID format'),
});

export type TaskParam = z.infer<typeof taskParamSchema>;

export const listTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z
    .enum([
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.IN_REVIEW,
      TaskStatus.DONE,
      TaskStatus.CANCELLED,
    ])
    .optional(),
  priority: z
    .enum([TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT])
    .optional(),
  assigneeId: z.uuid('Invalid assignee ID format').optional(),
  teamId: z.uuid('Invalid team ID format').optional(),
  search: z.string().trim().optional(),
  sortBy: z
    .enum(['createdAt', 'dueDate', 'priority', 'position', 'title', 'updatedAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
