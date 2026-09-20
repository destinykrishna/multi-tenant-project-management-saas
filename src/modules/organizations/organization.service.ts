import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { hashPassword } from '../../utils/password.js';
import {
  hashToken,
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiry,
} from '../../utils/jwt.js';
import { prisma } from '../../config/database.js';
import { addEmailJob } from '../../jobs/queues/email.queue.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { organizationRepository, type OrganizationRepository } from './organization.repository.js';
import { activityService, type ActivityService } from '../activity/activity.service.js';
import { cacheService, type CacheService, CACHE_KEYS, CACHE_TTL } from '../../utils/cache.js';
import {
  notificationService,
  type NotificationService,
} from '../notifications/notification.service.js';
import { NotificationType } from '../../constants/notification.js';
import { EntityType, ActivityAction } from '../../constants/activity.js';
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  AddMemberInput,
  UpdateMemberRoleInput,
} from './organization.schema.js';
import type {
  OrganizationResponse,
  UserOrganizationListItem,
  OrganizationMemberResponse,
} from './organization.types.js';

export class OrganizationService {
  constructor(
    private readonly repository: OrganizationRepository = organizationRepository,
    private readonly activity: ActivityService = activityService,
    private readonly cache: CacheService = cacheService,
    private readonly notification: NotificationService = notificationService,
  ) {}

  private slugify(text: string): string {
    const slug = text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return slug || 'org';
  }

  private async generateUniqueSlug(name: string, customSlug?: string): Promise<string> {
    if (customSlug) {
      const existing = await this.repository.findBySlug(customSlug);
      if (existing) {
        throw new ConflictError('Organization slug is already in use', 'SLUG_ALREADY_EXISTS');
      }
      return customSlug;
    }

    const baseSlug = this.slugify(name);
    const existing = await this.repository.findBySlug(baseSlug);

    if (!existing) {
      return baseSlug;
    }

    const randomSuffix = randomBytes(3).toString('hex');
    return `${baseSlug}-${randomSuffix}`;
  }

  async createOrganization(
    userId: string,
    input: CreateOrganizationInput,
  ): Promise<OrganizationResponse> {
    const existingMembership = await this.repository.findUserMembership(userId);
    if (existingMembership) {
      throw new ConflictError(
        'This user already belongs to an organization.',
        'USER_ALREADY_IN_ORGANIZATION',
      );
    }

    const slug = await this.generateUniqueSlug(input.name, input.slug);

    const organization = await this.repository.createOrganizationWithOwner(userId, {
      name: input.name.trim(),
      slug,
    });

    await this.cache.del(CACHE_KEYS.userOrganizations(userId));

    await this.activity.logActivity({
      organizationId: organization.id,
      userId,
      entityType: EntityType.ORGANIZATION,
      entityId: organization.id,
      action: ActivityAction.CREATED,
      metadata: { name: organization.name, slug: organization.slug },
    });

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      ownerId: organization.ownerId,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      role: 'OWNER',
    };
  }

  async getUserOrganizations(userId: string): Promise<UserOrganizationListItem[]> {
    return this.cache.getOrSet(
      CACHE_KEYS.userOrganizations(userId),
      async () => {
        const memberships = await this.repository.findUserOrganizations(userId);

        return memberships.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          ownerId: m.organization.ownerId,
          role: m.role,
          createdAt: m.organization.createdAt,
          updatedAt: m.organization.updatedAt,
        }));
      },
      CACHE_TTL.USER_ORGS,
    );
  }

  async getOrganizationById(organizationId: string): Promise<OrganizationResponse> {
    return this.cache.getOrSet(
      CACHE_KEYS.organization(organizationId),
      async () => {
        const organization = await this.repository.findById(organizationId);

        if (!organization) {
          throw new NotFoundError('Organization not found', 'ORGANIZATION_NOT_FOUND');
        }

        return {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          ownerId: organization.ownerId,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
          _count: organization._count,
        };
      },
      CACHE_TTL.ORGANIZATION,
    );
  }

  async updateOrganization(
    organizationId: string,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationResponse> {
    const existing = await this.repository.findById(organizationId);
    if (!existing) {
      throw new NotFoundError('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    if (input.slug && input.slug !== existing.slug) {
      const slugTaken = await this.repository.findBySlug(input.slug);
      if (slugTaken && slugTaken.id !== organizationId) {
        throw new ConflictError('Organization slug is already in use', 'SLUG_ALREADY_EXISTS');
      }
    }

    const updated = await this.repository.update(organizationId, {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.slug ? { slug: input.slug.trim() } : {}),
    });

    await this.cache.del(CACHE_KEYS.organization(organizationId));

    await this.activity.logActivity({
      organizationId: updated.id,
      userId: updated.ownerId,
      entityType: EntityType.ORGANIZATION,
      entityId: updated.id,
      action: ActivityAction.UPDATED,
      metadata: { name: updated.name, slug: updated.slug },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      ownerId: updated.ownerId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    const existing = await this.repository.findById(organizationId);
    if (!existing) {
      throw new NotFoundError('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }

    await this.repository.delete(organizationId);
    await this.cache.del(CACHE_KEYS.organization(organizationId));
  }

  // ─── Member Management ────────────────────────────────────────────────────────

  async getMembers(organizationId: string): Promise<OrganizationMemberResponse[]> {
    const [members, pendingInvitations] = await Promise.all([
      this.repository.findMembers(organizationId),
      this.repository.listPendingInvitations(organizationId),
    ]);

    const activeMembers: OrganizationMemberResponse[] = members.map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      isPending: false,
      user: {
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        isEmailVerified: m.user.isEmailVerified,
        createdAt: m.user.createdAt,
      },
    }));

    const invitedMembers: OrganizationMemberResponse[] = pendingInvitations.map((inv) => ({
      id: inv.id,
      organizationId: inv.organizationId,
      userId: inv.id,
      role: inv.role,
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt,
      isPending: true,
      user: {
        id: inv.id,
        name: inv.email.split('@')[0] ?? 'Invited User',
        email: inv.email,
        avatarUrl: null,
        isEmailVerified: false,
        createdAt: inv.createdAt,
      },
    }));

    return [...activeMembers, ...invitedMembers];
  }

  async addMember(
    organizationId: string,
    input: AddMemberInput,
    invitedById?: string,
  ): Promise<OrganizationMemberResponse> {
    // 1. Get organization details for invitation email
    const org = await this.repository.findById(organizationId);
    if (!org) {
      throw new NotFoundError('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }
    const orgName = org.name || 'Workspace';

    const normalizedEmail = input.email.toLowerCase().trim();

    // 2. Find user by email
    const user = await this.repository.findUserByEmail(normalizedEmail);

    // 3. Case A: User already exists on platform -> Add direct membership if no org
    if (user) {
      const existingMembership = await this.repository.findUserMembership(user.id);
      if (existingMembership) {
        if (existingMembership.organizationId === organizationId) {
          throw new ConflictError(
            'User is already a member of this organization',
            'MEMBER_ALREADY_EXISTS',
          );
        } else {
          // Scenario 3: User already belongs to another organization!
          // Reject invitation and do NOT reveal any details of their current organization.
          throw new ConflictError(
            'This user already belongs to an organization.',
            'USER_ALREADY_IN_ORGANIZATION',
          );
        }
      }

      let member;
      try {
        member = await this.repository.addMember(organizationId, user.id, input.role);
      } catch (err: any) {
        if (err.code === 'P2002') {
          throw new ConflictError(
            'This user already belongs to an organization.',
            'USER_ALREADY_IN_ORGANIZATION',
          );
        }
        throw err;
      }

      // Invalidate any other pending invitations for this user
      await this.repository.invalidatePendingInvitationsByEmail(normalizedEmail);

      await this.cache.del([
        CACHE_KEYS.userOrganizations(user.id),
        CACHE_KEYS.organization(organizationId),
      ]);

      await this.activity.logActivity({
        organizationId,
        userId: user.id,
        entityType: EntityType.USER,
        entityId: user.id,
        action: ActivityAction.MEMBER_ADDED,
        metadata: { role: input.role, email: normalizedEmail },
      });

      await this.notification.queueNotification({
        userId: user.id,
        organizationId,
        type: NotificationType.MEMBER_ADDED,
        title: 'Added to Organization',
        message: `You have been added to ${orgName} with role ${input.role}`,
        metadata: { organizationId, role: input.role },
      });

      const appUrl = env.CORS_ORIGIN || 'http://localhost:3000';
      try {
        await addEmailJob({
          to: input.email,
          subject: `You've been added to ${orgName}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">Workspace Invitation</h2>
              <p style="color: #334155; font-size: 14px; line-height: 1.6;">You have been added to <strong>${orgName}</strong> with the role of <strong style="color: #2563eb;">${input.role}</strong>.</p>
              <p style="color: #334155; font-size: 14px; line-height: 1.6;">You can access this workspace immediately using your existing account credentials.</p>
              <p style="margin: 24px 0;">
                <a href="${appUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 22px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Open Workspace</a>
              </p>
            </div>
          `,
          text: `You have been added to ${orgName} as a ${input.role}.\n\nAccess your workspace: ${appUrl}`,
        });
      } catch (emailErr) {
        logger.warn({ emailErr, email: input.email }, 'Failed to send workspace invitation email');
      }

      return {
        id: member.id,
        organizationId: member.organizationId,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        isPending: false,
        user: {
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          avatarUrl: member.user.avatarUrl,
          isEmailVerified: member.user.isEmailVerified,
          createdAt: member.user.createdAt,
        },
      };
    }

    // 4. Case B: User does NOT yet exist on platform -> Create/Refresh Invitation
    const effectiveInvitedById = invitedById || org.ownerId;
    const existingInvitation = await this.repository.findPendingInvitation(organizationId, normalizedEmail);

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    let invitationRecord;
    if (existingInvitation) {
      invitationRecord = await this.repository.updateInvitation(existingInvitation.id, {
        tokenHash,
        expiresAt,
        role: input.role,
        status: 'PENDING',
      });
    } else {
      invitationRecord = await this.repository.createInvitation({
        organizationId,
        email: normalizedEmail,
        role: input.role,
        tokenHash,
        invitedById: effectiveInvitedById,
        expiresAt,
      });
    }

    const appUrl = env.CORS_ORIGIN || 'http://localhost:3000';
    const inviteLink = `${appUrl}/invite?token=${rawToken}`;

    try {
      await addEmailJob({
        to: normalizedEmail,
        subject: `You've been invited to join ${orgName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
            <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">You're Invited!</h2>
            <p style="color: #334155; font-size: 14px; line-height: 1.6;">You have been invited to collaborate in <strong>${orgName}</strong> with the role of <strong style="color: #2563eb;">${input.role}</strong>.</p>
            <p style="color: #334155; font-size: 14px; line-height: 1.6;">Click the button below to accept your invitation and set up your account. This link will expire in 7 days.</p>
            <p style="margin: 24px 0;">
              <a href="${inviteLink}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Accept Invitation & Setup Account</a>
            </p>
            <p style="color: #64748b; font-size: 12px; line-height: 1.5;">Or copy and paste this URL into your browser:<br/><a href="${inviteLink}" style="color: #2563eb; word-break: break-all;">${inviteLink}</a></p>
          </div>
        `,
        text: `You have been invited to join ${orgName} as a ${input.role}.\n\nAccept your invitation and set up your account:\n${inviteLink}\n\nThis link expires in 7 days.`,
      });
    } catch (emailErr) {
      logger.warn({ emailErr, email: normalizedEmail }, 'Failed to queue invitation email');
    }

    return {
      id: invitationRecord.id,
      organizationId,
      userId: invitationRecord.id,
      role: input.role,
      createdAt: invitationRecord.createdAt,
      updatedAt: invitationRecord.updatedAt,
      isPending: true,
      user: {
        id: invitationRecord.id,
        name: input.name?.trim() || (normalizedEmail.split('@')[0] ?? 'Invited User'),
        email: normalizedEmail,
        avatarUrl: null,
        isEmailVerified: false,
        createdAt: invitationRecord.createdAt,
      },
    };
  }

  async updateMemberRole(
    organizationId: string,
    targetUserId: string,
    input: UpdateMemberRoleInput,
  ): Promise<OrganizationMemberResponse> {
    const member = await this.repository.findMember(organizationId, targetUserId);
    if (!member) {
      throw new NotFoundError('Member not found in this organization', 'MEMBER_NOT_FOUND');
    }

    if (member.role === 'OWNER') {
      throw new BadRequestError(
        'Organization owner role cannot be modified',
        'CANNOT_MODIFY_OWNER_ROLE',
      );
    }

    const updated = await this.repository.updateMemberRole(
      organizationId,
      targetUserId,
      input.role,
    );

    await this.cache.del([
      CACHE_KEYS.userOrganizations(targetUserId),
      CACHE_KEYS.organization(organizationId),
    ]);

    await this.activity.logActivity({
      organizationId,
      userId: targetUserId,
      entityType: EntityType.USER,
      entityId: targetUserId,
      action: ActivityAction.UPDATED,
      metadata: { previousRole: member.role, newRole: input.role },
    });

    await this.notification.queueNotification({
      userId: targetUserId,
      organizationId,
      type: NotificationType.MEMBER_ADDED,
      title: 'Role Updated',
      message: `Your role in the organization was updated to ${input.role}`,
      metadata: { organizationId, newRole: input.role },
    });

    return {
      id: updated.id,
      organizationId: updated.organizationId,
      userId: updated.userId,
      role: updated.role,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      user: {
        id: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
        avatarUrl: updated.user.avatarUrl,
        isEmailVerified: updated.user.isEmailVerified,
        createdAt: updated.user.createdAt,
      },
    };
  }

  async removeMember(organizationId: string, targetUserId: string): Promise<void> {
    const member = await this.repository.findMember(organizationId, targetUserId);
    if (!member) {
      throw new NotFoundError('Member not found in this organization', 'MEMBER_NOT_FOUND');
    }

    if (member.role === 'OWNER') {
      throw new BadRequestError(
        'Organization owner cannot be removed from the organization',
        'CANNOT_REMOVE_OWNER',
      );
    }

    await this.repository.removeMember(organizationId, targetUserId);

    await this.cache.del([
      CACHE_KEYS.userOrganizations(targetUserId),
      CACHE_KEYS.organization(organizationId),
    ]);

    await this.activity.logActivity({
      organizationId,
      userId: targetUserId,
      entityType: EntityType.USER,
      entityId: targetUserId,
      action: ActivityAction.MEMBER_REMOVED,
      metadata: { role: member.role },
    });
  }

  async getInvitationByToken(rawToken: string) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestError('Invitation token is required', 'INVALID_INVITATION_TOKEN');
    }

    const tokenHash = hashToken(rawToken);
    const invitation = await this.repository.findInvitationByTokenHash(tokenHash);

    if (!invitation) {
      throw new NotFoundError('Invitation not found or invalid', 'INVITATION_NOT_FOUND');
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

    if (invitation.status === 'EXPIRED') {
      throw new BadRequestError('Invitation has expired', 'INVITATION_EXPIRED');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestError(
        `Invitation is no longer valid (status: ${invitation.status})`,
        'INVITATION_ALREADY_USED',
      );
    }

    if (new Date() > invitation.expiresAt) {
      await this.repository.updateInvitation(invitation.id, { status: 'EXPIRED' });
      throw new BadRequestError('Invitation has expired', 'INVITATION_EXPIRED');
    }

    // Invariant check: Check if the user already joined an organization since the invite was sent
    const normalizedEmail = invitation.email.toLowerCase().trim();
    const existingUser = await this.repository.findUserByEmail(normalizedEmail);
    if (existingUser) {
      const existingMembership = await this.repository.findUserMembership(existingUser.id);
      if (existingMembership) {
        if (existingMembership.organizationId === invitation.organizationId) {
          throw new BadRequestError(
            'You are already a member of this organization',
            'MEMBER_ALREADY_EXISTS',
          );
        } else {
          // Scenario 4: User already belongs to another organization
          throw new BadRequestError(
            'This user already belongs to an organization.',
            'USER_ALREADY_IN_ORGANIZATION',
          );
        }
      }
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      organizationId: invitation.organizationId,
      organizationName: invitation.organization.name,
      invitedBy: {
        name: invitation.invitedBy.name,
        email: invitation.invitedBy.email,
      },
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(
    rawToken: string,
    input: { name?: string; password?: string },
    context: { userAgent?: string; ipAddress?: string } = {},
  ) {
    // 1. Validate token format and fetch invitation
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestError('Invitation token is required', 'INVALID_INVITATION_TOKEN');
    }

    const tokenHash = hashToken(rawToken);
    const invitation = await this.repository.findInvitationByTokenHash(tokenHash);

    if (!invitation) {
      throw new NotFoundError('Invitation not found or invalid', 'INVITATION_NOT_FOUND');
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
        `Invitation is no longer valid (status: ${invitation.status})`,
        'INVITATION_INVALID',
      );
    }

    if (new Date() > invitation.expiresAt) {
      await this.repository.updateInvitation(invitation.id, { status: 'EXPIRED' });
      throw new BadRequestError('Invitation has expired', 'INVITATION_EXPIRED');
    }

    // 2. Prepare user password hash if new user
    const normalizedEmail = invitation.email.toLowerCase().trim();
    const existingUser = await this.repository.findUserByEmail(normalizedEmail);
    let passwordHash: string | undefined;

    if (!existingUser) {
      if (!input.password || input.password.length < 8) {
        throw new BadRequestError(
          'Password must be at least 8 characters long',
          'PASSWORD_TOO_SHORT',
        );
      }
      passwordHash = await hashPassword(input.password);
    }

    // 3. Atomically accept invitation, enforce single-org invariant, and invalidate other pending invites
    const {
      user: finalUser,
      member: finalMember,
      organization,
    } = await this.repository.acceptInvitationTransaction({
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      email: normalizedEmail,
      name: input.name?.trim() || (normalizedEmail.split('@')[0] ?? 'Member'),
      passwordHash,
      role: invitation.role,
    });

    // 4. Session, token, and cache management
    const tokenId = randomUUID();
    const accessToken = generateAccessToken({
      userId: finalUser.id,
      email: finalUser.email,
    });
    const refreshToken = generateRefreshToken({
      userId: finalUser.id,
      tokenId,
    });
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = getRefreshTokenExpiry();

    await prisma.refreshSession.create({
      data: {
        userId: finalUser.id,
        tokenHash: refreshTokenHash,
        expiresAt,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
      },
    });

    await this.cache.del([
      CACHE_KEYS.userOrganizations(finalUser.id),
      CACHE_KEYS.organization(organization.id),
    ]);

    await this.activity.logActivity({
      organizationId: organization.id,
      userId: finalUser.id,
      entityType: EntityType.USER,
      entityId: finalUser.id,
      action: ActivityAction.MEMBER_ADDED,
      metadata: { role: invitation.role, email: finalUser.email, viaInvitation: true },
    });

    return {
      user: {
        id: finalUser.id,
        name: finalUser.name,
        email: finalUser.email,
        avatarUrl: finalUser.avatarUrl,
        isEmailVerified: finalUser.isEmailVerified,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        role: finalMember.role,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
    };
  }
}

export const organizationService = new OrganizationService();
