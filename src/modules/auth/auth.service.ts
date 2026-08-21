import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, comparePassword } from '../../utils/password.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
} from '../../utils/jwt.js';
import { ConflictError, UnauthorizedError } from '../../utils/errors.js';
import { authRepository, type AuthRepository } from './auth.repository.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';
import type { RegisterResult, LoginResult, RefreshResult, SafeUser } from './auth.types.js';

export interface AuthContext {
  userAgent?: string;
  ipAddress?: string;
}

export class AuthService {
  constructor(private readonly repository: AuthRepository = authRepository) {}

  private slugify(text: string): string {
    const slug = text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return slug || 'org';
  }

  private async generateUniqueSlug(organizationName: string): Promise<string> {
    const baseSlug = this.slugify(organizationName);
    const existing = await this.repository.findOrganizationBySlug(baseSlug);

    if (!existing) {
      return baseSlug;
    }

    const randomSuffix = randomBytes(3).toString('hex');
    return `${baseSlug}-${randomSuffix}`;
  }

  async register(input: RegisterInput, context: AuthContext = {}): Promise<RegisterResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // 1. Check if user already exists
    const existingUser = await this.repository.findUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new ConflictError('User with this email already exists', 'USER_ALREADY_EXISTS');
    }

    // 2. Hash password
    const passwordHash = await hashPassword(input.password);

    // 3. Generate unique organization slug
    const organizationSlug = await this.generateUniqueSlug(input.organizationName);

    // 4. Generate user ID, tokens, and hashed refresh session
    const userId = randomUUID();
    const tokenId = randomUUID();

    const accessToken = generateAccessToken({
      userId,
      email: normalizedEmail,
    });

    const refreshToken = generateRefreshToken({
      userId,
      tokenId,
    });

    const tokenHash = hashToken(refreshToken);
    const expiresAt = getRefreshTokenExpiry();

    // 5. Execute atomic transaction in repository
    const { user, organization } = await this.repository.registerUserAndOrganization({
      userId,
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash,
      organizationName: input.organizationName.trim(),
      organizationSlug,
      tokenHash,
      expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return {
      accessToken,
      refreshToken,
      user,
      organization,
    };
  }

  async login(input: LoginInput, context: AuthContext = {}): Promise<LoginResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // 1. Find user by email
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // 2. Verify password
    const isPasswordValid = await comparePassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // 3. Generate tokens
    const tokenId = randomUUID();

    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      tokenId,
    });

    const tokenHash = hashToken(refreshToken);
    const expiresAt = getRefreshTokenExpiry();

    // 4. Create RefreshSession
    await this.repository.createRefreshSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    const safeUser: SafeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return {
      accessToken,
      refreshToken,
      user: safeUser,
    };
  }

  async refresh(rawRefreshToken: string, context: AuthContext = {}): Promise<RefreshResult> {
    // 1. Verify JWT signature & structure
    try {
      verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // 2. Hash raw token and find session in database
    const tokenHash = hashToken(rawRefreshToken);
    const session = await this.repository.findRefreshSessionByHash(tokenHash);

    if (!session) {
      throw new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // 3. Check if session has been revoked (Token Reuse Detection / Replay Attack)
    if (session.revokedAt) {
      await this.repository.revokeAllUserSessions(session.userId);
      throw new UnauthorizedError(
        'Refresh token has been revoked due to reuse detection',
        'TOKEN_REVOKED',
      );
    }

    // 4. Check if session has expired
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token has expired', 'TOKEN_EXPIRED');
    }

    // 5. Generate new access and refresh tokens
    const newAccessToken = generateAccessToken({
      userId: session.user.id,
      email: session.user.email,
    });

    const newRefreshToken = generateRefreshToken({
      userId: session.user.id,
      tokenId: randomUUID(),
    });

    const newTokenHash = hashToken(newRefreshToken);
    const newExpiresAt = getRefreshTokenExpiry();

    // 6. Atomically revoke old session and persist new session
    await this.repository.rotateRefreshSession(session.id, {
      userId: session.user.id,
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: session.user,
    };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = hashToken(rawRefreshToken);
    await this.repository.revokeRefreshSessionByHash(tokenHash);
  }
}

export const authService = new AuthService();
