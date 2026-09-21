import { randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { hashPassword, comparePassword } from '../../utils/password.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
  type AccessTokenPayload,
} from '../../utils/jwt.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { authRepository, type AuthRepository } from './auth.repository.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';
import type {
  RegisterResult,
  LoginResult,
  RefreshResult,
  SafeUser,
  StandardLoginSuccess,
} from './auth.types.js';
import { TotpService } from '../../utils/totp.js';
import { tokenRevocationBloom } from '../../utils/bloom.js';

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

    // 2.5 Two-Factor Authentication Challenge
    if (user.totpEnabled) {
      const mfaToken = jwt.sign({ userId: user.id, purpose: 'mfa_challenge' }, env.JWT_SECRET, {
        expiresIn: '5m',
      });
      return {
        requiresMfa: true,
        mfaToken,
      };
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

  async logout(
    input?: { rawRefreshToken?: string; accessToken?: string; jti?: string } | string,
    legacyJti?: string,
  ): Promise<void> {
    let rawRefreshToken: string | undefined;
    let accessToken: string | undefined;
    let jti: string | undefined;

    if (typeof input === 'string' || input === undefined) {
      rawRefreshToken = input;
      jti = legacyJti;
    } else {
      rawRefreshToken = input.rawRefreshToken;
      accessToken = input.accessToken;
      jti = input.jti;
    }

    // 1. If an access token is provided, extract JTI and revoke with bounded TTL
    if (accessToken) {
      try {
        const payload = jwt.verify(accessToken, env.JWT_SECRET) as AccessTokenPayload;
        if (payload.jti) {
          let ttlSeconds = 900;
          if (payload.exp) {
            const remaining = payload.exp - Math.floor(Date.now() / 1000);
            ttlSeconds = Math.max(1, remaining);
          }
          await tokenRevocationBloom.revoke(payload.jti, ttlSeconds);
        }
      } catch {
        // If expired or invalid, attempt graceful decoding without verification
        try {
          const decoded = jwt.decode(accessToken) as AccessTokenPayload | null;
          if (decoded?.jti && decoded.exp) {
            const remaining = decoded.exp - Math.floor(Date.now() / 1000);
            if (remaining > 0) {
              await tokenRevocationBloom.revoke(decoded.jti, remaining);
            }
          }
        } catch {
          // Gracefully ignore malformed tokens
        }
      }
    } else if (jti) {
      await tokenRevocationBloom.revoke(jti);
    }

    // 2. Always revoke the refresh session in database if provided
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await this.repository.revokeRefreshSessionByHash(tokenHash);
    }
  }

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    currentJti?: string,
  ): Promise<{ message: string }> {
    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found', 'USER_NOT_FOUND');
    }

    const isCurrentValid = await comparePassword(input.currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new UnauthorizedError('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
    }

    const newPasswordHash = await hashPassword(input.newPassword);
    await this.repository.updatePassword(userId, newPasswordHash);

    // Invalidate all active refresh sessions for this user on password change
    await this.repository.revokeAllUserSessions(userId);

    // Revoke current access token in Bloom filter & Redis denylist
    if (currentJti) {
      await tokenRevocationBloom.revoke(currentJti);
    }

    return { message: 'Password updated successfully' };
  }

  async setup2fa(userId: string): Promise<{ secret: string; otpAuthUri: string }> {
    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found', 'USER_NOT_FOUND');
    }

    const secret = TotpService.generateSecret();
    await this.repository.updateTotpSecret(userId, secret, false);

    const otpAuthUri = TotpService.generateOtpAuthUri(user.email, 'SaaS-Platform', secret);
    return { secret, otpAuthUri };
  }

  async verifyAndEnable2fa(
    userId: string,
    code: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.totpSecret) {
      throw new BadRequestError('2FA setup has not been initiated', 'MFA_NOT_INITIATED');
    }

    const isValid = TotpService.verifyCode(user.totpSecret, code);
    if (!isValid) {
      throw new UnauthorizedError('Invalid two-factor authentication code', 'INVALID_MFA_CODE');
    }

    await this.repository.updateTotpSecret(userId, user.totpSecret, true);
    return { success: true, message: 'Two-factor authentication enabled successfully' };
  }

  async disable2fa(userId: string, code: string): Promise<{ success: boolean; message: string }> {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new BadRequestError('Two-factor authentication is not active', 'MFA_NOT_ACTIVE');
    }

    const isValid = TotpService.verifyCode(user.totpSecret, code);
    if (!isValid) {
      throw new UnauthorizedError('Invalid two-factor authentication code', 'INVALID_MFA_CODE');
    }

    await this.repository.updateTotpSecret(userId, null, false);
    return { success: true, message: 'Two-factor authentication disabled successfully' };
  }

  async verifyMfaLogin(
    mfaToken: string,
    code: string,
    context: AuthContext = {},
  ): Promise<StandardLoginSuccess> {
    let payload: { userId: string; purpose: string };
    try {
      payload = jwt.verify(mfaToken, env.JWT_SECRET) as { userId: string; purpose: string };
    } catch {
      throw new UnauthorizedError('Invalid or expired MFA token', 'INVALID_MFA_TOKEN');
    }

    if (payload.purpose !== 'mfa_challenge') {
      throw new UnauthorizedError('Invalid token purpose', 'INVALID_MFA_TOKEN');
    }

    const user = await this.repository.findUserById(payload.userId);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedError('User does not have 2FA enabled', 'MFA_NOT_ENABLED');
    }

    const isValid = TotpService.verifyCode(user.totpSecret, code);
    if (!isValid) {
      throw new UnauthorizedError('Invalid two-factor authentication code', 'INVALID_MFA_CODE');
    }

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
      totpEnabled: true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return {
      accessToken,
      refreshToken,
      user: safeUser,
    };
  }
}

export const authService = new AuthService();
