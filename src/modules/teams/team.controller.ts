import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../utils/response.js';
import { teamService, type TeamService } from './team.service.js';
import type { CreateTeamInput, UpdateTeamInput } from './team.schema.js';

export class TeamController {
  constructor(private readonly service: TeamService = teamService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const result = await this.service.listTeams(organizationId);
      sendSuccess(res, result, 200, 'Teams retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const teamId = req.params['teamId'] as string;
      const result = await this.service.getTeamById(organizationId, teamId);
      sendSuccess(res, result, 200, 'Team retrieved successfully');
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const input = req.body as CreateTeamInput;
      const result = await this.service.createTeam(organizationId, input);
      sendSuccess(res, result, 201, 'Team created successfully');
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const teamId = req.params['teamId'] as string;
      const input = req.body as UpdateTeamInput;
      const result = await this.service.updateTeam(organizationId, teamId, input);
      sendSuccess(res, result, 200, 'Team updated successfully');
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.params['organizationId'] as string;
      const teamId = req.params['teamId'] as string;
      await this.service.deleteTeam(organizationId, teamId);
      sendSuccess(res, null, 200, 'Team deleted successfully');
    } catch (error) {
      next(error);
    }
  };
}

export const teamController = new TeamController();
