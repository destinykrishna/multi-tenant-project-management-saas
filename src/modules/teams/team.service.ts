import { BadRequestError, NotFoundError, ConflictError } from '../../utils/errors.js';
import { teamRepository, type TeamRepository } from './team.repository.js';
import type { CreateTeamInput, UpdateTeamInput } from './team.schema.js';
import type { TeamResponse } from './team.types.js';

export class TeamService {
  constructor(private readonly repository: TeamRepository = teamRepository) {}

  private async validateMemberUserIds(organizationId: string, memberUserIds?: string[]) {
    if (!memberUserIds || memberUserIds.length === 0) return [];

    const uniqueIds = Array.from(new Set(memberUserIds));
    const validIds = await this.repository.getOrgMemberUserIds(organizationId, uniqueIds);

    if (validIds.length !== uniqueIds.length) {
      throw new BadRequestError(
        'One or more team members are not members of the organization',
        'INVALID_TEAM_MEMBER',
      );
    }

    return uniqueIds;
  }

  async listTeams(organizationId: string): Promise<TeamResponse[]> {
    const teams = await this.repository.listTeams(organizationId);
    return teams.map((team) => ({
      id: team.id,
      organizationId: team.organizationId,
      name: team.name,
      description: team.description,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      members: team.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        user: m.user,
      })),
      _count: team._count,
    }));
  }

  async getTeamById(organizationId: string, teamId: string): Promise<TeamResponse> {
    const team = await this.repository.findById(organizationId, teamId);
    if (!team) {
      throw new NotFoundError('Team not found in this organization', 'TEAM_NOT_FOUND');
    }

    return {
      id: team.id,
      organizationId: team.organizationId,
      name: team.name,
      description: team.description,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      members: team.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        user: m.user,
      })),
      _count: team._count,
    };
  }

  async createTeam(organizationId: string, input: CreateTeamInput): Promise<TeamResponse> {
    const name = input.name.trim();
    const existing = await this.repository.findByName(organizationId, name);
    if (existing) {
      throw new ConflictError(
        'A team with this name already exists in this organization',
        'TEAM_NAME_EXISTS',
      );
    }

    const validatedMemberIds = await this.validateMemberUserIds(
      organizationId,
      input.memberUserIds,
    );

    const team = await this.repository.createTeam({
      organizationId,
      name,
      description: input.description?.trim() ?? null,
      memberUserIds: validatedMemberIds,
    });

    return {
      id: team.id,
      organizationId: team.organizationId,
      name: team.name,
      description: team.description,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      members: team.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        user: m.user,
      })),
      _count: team._count,
    };
  }

  async updateTeam(
    organizationId: string,
    teamId: string,
    input: UpdateTeamInput,
  ): Promise<TeamResponse> {
    const team = await this.repository.findById(organizationId, teamId);
    if (!team) {
      throw new NotFoundError('Team not found in this organization', 'TEAM_NOT_FOUND');
    }

    const name = input.name?.trim();
    if (name && name !== team.name) {
      const existing = await this.repository.findByName(organizationId, name);
      if (existing) {
        throw new ConflictError(
          'A team with this name already exists in this organization',
          'TEAM_NAME_EXISTS',
        );
      }
    }

    let validatedMemberIds: string[] | undefined;
    if (input.memberUserIds !== undefined) {
      validatedMemberIds = await this.validateMemberUserIds(organizationId, input.memberUserIds);
    }

    const updated = await this.repository.updateTeam(organizationId, teamId, {
      name,
      description:
        input.description !== undefined ? (input.description?.trim() ?? null) : undefined,
      memberUserIds: validatedMemberIds,
    });

    return {
      id: updated.id,
      organizationId: updated.organizationId,
      name: updated.name,
      description: updated.description,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      members: updated.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        user: m.user,
      })),
      _count: updated._count,
    };
  }

  async deleteTeam(organizationId: string, teamId: string): Promise<void> {
    const team = await this.repository.findById(organizationId, teamId);
    if (!team) {
      throw new NotFoundError('Team not found in this organization', 'TEAM_NOT_FOUND');
    }

    await this.repository.deleteTeam(organizationId, teamId);
  }
}

export const teamService = new TeamService();
