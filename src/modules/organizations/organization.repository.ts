import { prisma } from '../../config/database.js';
import type { OrganizationRole } from '../../constants/roles.js';

export interface CreateOrgData {
  name: string;
  slug: string;
}

export interface UpdateOrgData {
  name?: string;
  slug?: string;
}

export class OrganizationRepository {
  async findById(id: string) {
    return prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            members: true,
            projects: true,
          },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    return prisma.organization.findUnique({
      where: { slug },
    });
  }

  async findUserByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findUserOrganizations(userId: string) {
    return prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            ownerId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMembers(organizationId: string) {
    return prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            isEmailVerified: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMember(organizationId: string, userId: string) {
    return prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            isEmailVerified: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async addMember(organizationId: string, userId: string, role: OrganizationRole) {
    return prisma.organizationMember.create({
      data: {
        organizationId,
        userId,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            isEmailVerified: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async updateMemberRole(organizationId: string, userId: string, role: OrganizationRole) {
    return prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      data: {
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            isEmailVerified: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async removeMember(organizationId: string, userId: string) {
    return prisma.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });
  }

  async createOrganizationWithOwner(userId: string, data: CreateOrgData) {
    return prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: data.name,
          slug: data.slug,
          ownerId: userId,
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId,
          role: 'OWNER',
        },
      });

      return organization;
    });
  }

  async update(id: string, data: UpdateOrgData) {
    return prisma.organization.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return prisma.organization.delete({
      where: { id },
    });
  }
}

export const organizationRepository = new OrganizationRepository();
