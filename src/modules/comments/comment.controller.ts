import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { commentService, type CommentService } from './comment.service.js';
import type {
  CreateCommentInput,
  UpdateCommentInput,
  ListCommentsQuery,
} from './comment.schema.js';

export class CommentController {
  constructor(private readonly service: CommentService = commentService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const userId = req.user.id;
      const input = req.body as CreateCommentInput;

      const result = await this.service.createComment(
        organizationId,
        projectId,
        taskId,
        userId,
        input,
      );

      sendSuccess(res, result, 201, 'Comment created successfully');
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const query = req.query as unknown as ListCommentsQuery;

      const result = await this.service.getComments(organizationId, projectId, taskId, query);

      sendSuccess(res, result, 200, 'Comments retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const commentId = req.params['commentId'] as string;
      const userId = req.user.id;
      const input = req.body as UpdateCommentInput;

      const result = await this.service.updateComment(
        organizationId,
        projectId,
        taskId,
        commentId,
        userId,
        input,
      );

      sendSuccess(res, result, 200, 'Comment updated successfully');
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const organizationId = req.params['organizationId'] as string;
      const projectId = req.params['projectId'] as string;
      const taskId = req.params['taskId'] as string;
      const commentId = req.params['commentId'] as string;
      const userId = req.user.id;
      const role = req.membership?.role ?? '';

      await this.service.deleteComment(organizationId, projectId, taskId, commentId, userId, role);

      sendSuccess(res, null, 200, 'Comment deleted successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const commentController = new CommentController();
