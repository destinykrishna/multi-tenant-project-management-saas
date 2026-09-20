import { prisma } from '../../config/database.js';

export interface CreateTeamRepoData {
  organizationId: string;
  name: string;
  description?: string | null;
  memberUserIds?: string[];
}

export interface UpdateTeamRepoData {
  name?: string;
  description?: string | null;
  memberUserIds?: string[];
}

const teamInclude = {
  members: {
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  },
  _count: {
    select: {
      members: true,
      tasks: true,
    },
  },
} as const;

export class TeamRepository {
  async listTeams(organizationId: string) {
    return prisma.team.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: teamInclude,
    });
  }

  async findById(organizationId: string, teamId: string) {
    return prisma.team.findFirst({
      where: { id: teamId, organizationId },
      include: teamInclude,
    });
  }

  async findByName(organizationId: string, name: string) {
    return prisma.team.findFirst({
      where: { organizationId, name },
    });
  }

  async createTeam(data: CreateTeamRepoData) {
    return prisma.team.create({
      data: {
        organizationId: data.organizationId,
        name: data.name,
        description: data.description,
        ...(data.memberUserIds && data.memberUserIds.length > 0
          ? {
              members: {
                create: data.memberUserIds.map((userId) => ({ userId })),
              },
            }
          : {}),
      },
      include: teamInclude,
    });
  }

  async updateTeam(organizationId: string, teamId: string, data: UpdateTeamRepoData) {
    return prisma.$transaction(async (tx) => {
      if (data.memberUserIds !== undefined) {
        await tx.teamMember.deleteMany({
          where: { teamId },
        });

        if (data.memberUserIds.length > 0) {
          await tx.teamMember.createMany({
            data: data.memberUserIds.map((userId) => ({ teamId, userId })),
          });
        }
      }

      return tx.team.update({
        where: { id: teamId },
        data: {
          ...(data.name ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
        include: teamInclude,
      });
    });
  }

  async deleteTeam(organizationId: string, teamId: string) {
    return prisma.team.delete({
      where: { id: teamId },
    });
  }

  async getOrgMemberUserIds(organizationId: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        userId: { in: userIds },
      },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
}

export const teamRepository = new TeamRepository();
