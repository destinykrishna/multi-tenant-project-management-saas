import { randomBytes } from 'node:crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
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
    const members = await this.repository.findMembers(organizationId);

    return members.map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      user: {
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        isEmailVerified: m.user.isEmailVerified,
        createdAt: m.user.createdAt,
      },
    }));
  }

  async addMember(
    organizationId: string,
    input: AddMemberInput,
  ): Promise<OrganizationMemberResponse> {
    // 1. Find user by email
    const user = await this.repository.findUserByEmail(input.email);
    if (!user) {
      throw new NotFoundError('User with this email was not found', 'USER_NOT_FOUND');
    }

    // 2. Check if already a member
    const existingMember = await this.repository.findMember(organizationId, user.id);
    if (existingMember) {
      throw new ConflictError(
        'User is already a member of this organization',
        'MEMBER_ALREADY_EXISTS',
      );
    }

    // 3. Add member
    const member = await this.repository.addMember(organizationId, user.id, input.role);

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
      metadata: { role: input.role, email: input.email },
    });

    await this.notification.queueNotification({
      userId: user.id,
      organizationId,
      type: NotificationType.MEMBER_ADDED,
      title: 'Added to Organization',
      message: `You have been added to the organization with role ${input.role}`,
      metadata: { organizationId, role: input.role },
    });

    return {
      id: member.id,
      organizationId: member.organizationId,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
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
}

export const organizationService = new OrganizationService();
