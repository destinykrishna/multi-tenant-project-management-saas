import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { taskService, type TaskService } from './task.service.js';
import type { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from './task.schema.js';

export class TaskController {
  constructor(private readonly service: TaskService = taskService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const userId = req.user.id;
      const input = req.body as CreateTaskInput;

      const result = await this.service.createTask(organizationId, projectId, userId, input);

      sendSuccess(res, result, 201, 'Task created successfully');
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const query = req.query as unknown as ListTasksQuery;

      const result = await this.service.getTasks(organizationId, projectId, query);

      sendSuccess(res, result, 200, 'Tasks retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;

      const result = await this.service.getTaskById(organizationId, projectId, taskId);

      sendSuccess(res, result, 200, 'Task retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const input = req.body as UpdateTaskInput;

      const result = await this.service.updateTask(organizationId, projectId, taskId, input);

      sendSuccess(res, result, 200, 'Task updated successfully');
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;

      await this.service.deleteTask(organizationId, projectId, taskId);

      sendSuccess(res, null, 200, 'Task deleted successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const taskController = new TaskController();
