import { prisma } from '../../config/database.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { OrganizationRole } from '../../constants/roles.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';

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

  async createUser(data: { name: string; email: string; passwordHash: string }) {
    return prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        isEmailVerified: true,
      },
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

  async findUserMembership(userId: string) {
    return prisma.organizationMember.findUnique({
      where: { userId },
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
      },
    });
  }

  async createOrganizationWithOwner(userId: string, data: CreateOrgData) {
    return prisma.$transaction(async (tx) => {
      const existingMembership = await tx.organizationMember.findUnique({
        where: { userId },
      });
      if (existingMembership) {
        throw new ConflictError(
          'This user already belongs to an organization.',
          'USER_ALREADY_IN_ORGANIZATION',
        );
      }

      const organization = await tx.organization.create({
        data: {
          name: data.name,
          slug: data.slug,
          ownerId: userId,
        },
      });

      try {
        await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId,
            role: 'OWNER',
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          throw new ConflictError(
            'This user already belongs to an organization.',
            'USER_ALREADY_IN_ORGANIZATION',
          );
        }
        throw err;
      }

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

  async createInvitation(data: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }) {
    const normalizedEmail = data.email.toLowerCase().trim();
    return prisma.organizationInvitation.create({
      data: {
        organizationId: data.organizationId,
        email: normalizedEmail,
        role: data.role,
        tokenHash: data.tokenHash,
        invitedById: data.invitedById,
        expiresAt: data.expiresAt,
        status: 'PENDING',
      },
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async findPendingInvitation(organizationId: string, email: string) {
    return prisma.organizationInvitation.findFirst({
      where: {
        organizationId,
        email: email.toLowerCase().trim(),
        status: 'PENDING',
      },
    });
  }

  async findInvitationByTokenHash(tokenHash: string) {
    return prisma.organizationInvitation.findUnique({
      where: { tokenHash },
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async updateInvitation(
    id: string,
    data: {
      tokenHash?: string;
      expiresAt?: Date;
      status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'INVALIDATED';
      acceptedAt?: Date | null;
      role?: OrganizationRole;
    },
  ) {
    return prisma.organizationInvitation.update({
      where: { id },
      data,
    });
  }

  async invalidatePendingInvitationsByEmail(
    email: string,
    excludeInvitationId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || prisma;
    return client.organizationInvitation.updateMany({
      where: {
        email: email.toLowerCase().trim(),
        status: 'PENDING',
        ...(excludeInvitationId ? { id: { not: excludeInvitationId } } : {}),
      },
      data: {
        status: 'INVALIDATED',
      },
    });
  }

  async listPendingInvitations(organizationId: string) {
    return prisma.organizationInvitation.findMany({
      where: {
        organizationId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptInvitationTransaction(params: {
    invitationId: string;
    organizationId: string;
    email: string;
    name?: string;
    passwordHash?: string;
    role: OrganizationRole;
  }) {
    const normalizedEmail = params.email.toLowerCase().trim();

    return prisma.$transaction(async (tx) => {
      // 1. Fetch current invitation to verify status within transaction
      const invitation = await tx.organizationInvitation.findUnique({
        where: { id: params.invitationId },
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      });

      if (!invitation) {
        throw new NotFoundError('Invitation not found', 'INVITATION_NOT_FOUND');
      }

      if (invitation.status === 'ACCEPTED') {
        throw new BadRequestError(
          'This invitation has already been accepted',
          'INVITATION_ALREADY_ACCEPTED',
        );
      }

      if (invitation.status === 'INVALIDATED') {
        throw new BadRequestError(
          'This invitation is no longer valid because another organization invitation was accepted',
          'INVITATION_INVALIDATED',
        );
      }

      if (invitation.status !== 'PENDING') {
        throw new BadRequestError(
          `This invitation is no longer valid (status: ${invitation.status})`,
          'INVITATION_INVALID',
        );
      }

      if (new Date() > invitation.expiresAt) {
        await tx.organizationInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' },
        });
        throw new BadRequestError('Invitation has expired', 'INVITATION_EXPIRED');
      }

      // 2. Check if user already exists
      let user = await tx.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (user) {
        // Invariant check: Does user already belong to an organization?
        const existingMembership = await tx.organizationMember.findUnique({
          where: { userId: user.id },
        });

        if (existingMembership) {
          if (existingMembership.organizationId === params.organizationId) {
            throw new ConflictError(
              'You are already a member of this organization',
              'MEMBER_ALREADY_EXISTS',
            );
          } else {
            // Scenario 4: User already belongs to another org. Never leak current org details!
            throw new ConflictError(
              'This user already belongs to an organization.',
              'USER_ALREADY_IN_ORGANIZATION',
            );
          }
        }
      } else {
        if (!params.passwordHash) {
          throw new BadRequestError(
            'Password is required for new account setup',
            'PASSWORD_REQUIRED',
          );
        }

        try {
          user = await tx.user.create({
            data: {
              name: params.name || normalizedEmail.split('@')[0] || 'Member',
              email: normalizedEmail,
              passwordHash: params.passwordHash,
              isEmailVerified: true,
            },
          });
        } catch (err: any) {
          if (err.code === 'P2002') {
            throw new ConflictError(
              'This user already belongs to an organization.',
              'USER_ALREADY_IN_ORGANIZATION',
            );
          }
          throw err;
        }
      }

      // 3. Create membership (protected by PostgreSQL UNIQUE constraint on userId)
      let member;
      try {
        member = await tx.organizationMember.create({
          data: {
            organizationId: params.organizationId,
            userId: user.id,
            role: params.role,
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
      } catch (err: any) {
        // Catch Prisma unique constraint violation (P2002) in concurrent acceptance race
        if (err.code === 'P2002') {
          throw new ConflictError(
            'This user already belongs to an organization.',
            'USER_ALREADY_IN_ORGANIZATION',
          );
        }
        throw err;
      }

      // 4. Mark THIS invitation as ACCEPTED
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });

      // 5. Invalidate ALL other pending invitations for this user/email
      await tx.organizationInvitation.updateMany({
        where: {
          email: normalizedEmail,
          status: 'PENDING',
          id: { not: invitation.id },
        },
        data: {
          status: 'INVALIDATED',
        },
      });

      return { user, member, organization: invitation.organization };
    });
  }

  async acceptInvitationWithNewUser(params: {
    invitationId: string;
    organizationId: string;
    email: string;
    name: string;
    passwordHash: string;
    role: OrganizationRole;
  }) {
    return this.acceptInvitationTransaction(params);
  }
}

export const organizationRepository = new OrganizationRepository();
