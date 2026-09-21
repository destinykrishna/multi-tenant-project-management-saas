import { Request, Response, NextFunction } from 'express';
import { edgeService } from './edge.service.js';
import { sendSuccess } from '../../utils/response.js';

export class EdgeController {
  getStatus = (req: Request, res: Response, _next: NextFunction): void => {
    const telemetry = edgeService.getEdgeStatus(req.edge);
    sendSuccess(res, telemetry, 200, 'Edge security and CDN telemetry retrieved');
  };

  purgeCache = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await edgeService.purgeEdgeCache();
      sendSuccess(res, result, 200, result.message);
    } catch (error) {
      next(error);
    }
  };

  verifyTurnstile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body as { token: string };
      const clientIp = req.edge?.clientIp ?? req.ip ?? '127.0.0.1';
      const valid = await edgeService.verifyTurnstile(token, clientIp);
      sendSuccess(
        res,
        { verified: valid },
        200,
        valid ? 'Turnstile verification passed' : 'Verification failed',
      );
    } catch (error) {
      next(error);
    }
  };
}

export const edgeController = new EdgeController();
