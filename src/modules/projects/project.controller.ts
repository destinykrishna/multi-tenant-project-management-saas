import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { projectService, type ProjectService } from './project.service.js';
import type {
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQuery,
} from './project.schema.js';

export class ProjectController {
  constructor(private readonly service: ProjectService = projectService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const organizationId = req.params['organizationId'] as string;
      const userId = req.user.id;
      const input = req.body as CreateProjectInput;

      const result = await this.service.createProject(organizationId, userId, input);

      sendSuccess(res, result, 201, 'Project created successfully');
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const query = req.query as unknown as ListProjectsQuery;

      const result = await this.service.getProjects(organizationId, query);

      sendSuccess(res, result, 200, 'Projects retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;

      const result = await this.service.getProjectById(organizationId, projectId);

      sendSuccess(res, result, 200, 'Project retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const input = req.body as UpdateProjectInput;

      const result = await this.service.updateProject(organizationId, projectId, input);

      sendSuccess(res, result, 200, 'Project updated successfully');
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;

      await this.service.deleteProject(organizationId, projectId);

      sendSuccess(res, null, 200, 'Project deleted successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const projectController = new ProjectController();
