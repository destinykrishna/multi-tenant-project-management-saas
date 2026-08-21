import { prisma } from '../../config/database.js';
import type { SafeUser, SafeOrganization } from './auth.types.js';

export interface CreateRegistrationData {
  userId?: string;
  name: string;
  email: string;
  passwordHash: string;
  organizationName: string;
  organizationSlug: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface CreateRefreshSessionData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface RegistrationRecordResult {
  user: SafeUser;
  organization: SafeOrganization;
}

export class AuthRepository {
  async findUserByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findOrganizationBySlug(slug: string) {
    return prisma.organization.findUnique({
      where: { slug },
    });
  }

  async createRefreshSession(data: CreateRefreshSessionData) {
    return prisma.refreshSession.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
      },
    });
  }

  async findRefreshSessionByHash(tokenHash: string) {
    return prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            isEmailVerified: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async revokeRefreshSessionByHash(tokenHash: string): Promise<void> {
    await prisma.refreshSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await prisma.refreshSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async rotateRefreshSession(oldSessionId: string, newSessionData: CreateRefreshSessionData) {
    return prisma.$transaction(async (tx) => {
      // 1. Revoke the old session
      await tx.refreshSession.update({
        where: { id: oldSessionId },
        data: { revokedAt: new Date() },
      });

      // 2. Create the new session
      return tx.refreshSession.create({
        data: {
          userId: newSessionData.userId,
          tokenHash: newSessionData.tokenHash,
          expiresAt: newSessionData.expiresAt,
          userAgent: newSessionData.userAgent,
          ipAddress: newSessionData.ipAddress,
        },
      });
    });
  }

  async registerUserAndOrganization(
    data: CreateRegistrationData,
  ): Promise<RegistrationRecordResult> {
    return prisma.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          ...(data.userId ? { id: data.userId } : {}),
          name: data.name,
          email: data.email,
          passwordHash: data.passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          isEmailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // 2. Create Organization with user as owner
      const organization = await tx.organization.create({
        data: {
          name: data.organizationName,
          slug: data.organizationSlug,
          ownerId: user.id,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // 3. Create OrganizationMember with OWNER role
      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'OWNER',
        },
      });

      // 4. Create RefreshSession
      await tx.refreshSession.create({
        data: {
          userId: user.id,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          userAgent: data.userAgent,
          ipAddress: data.ipAddress,
        },
      });

      return {
        user,
        organization,
      };
    });
  }
}

export const authRepository = new AuthRepository();
