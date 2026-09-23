import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../utils/errors.js';
import { encryptToken, decryptToken } from '../../../utils/encryption.js';
import { googleRepository, type GoogleRepository } from './google.repository.js';
import type {
  GoogleConnectionStatusResponse,
  GoogleTokenResponse,
  GoogleUserInfo,
  GoogleOAuthStatePayload,
} from './google.types.js';

export const GOOGLE_SCOPES = {
  OPENID: 'openid',
  EMAIL: 'https://www.googleapis.com/auth/userinfo.email',
  PROFILE: 'https://www.googleapis.com/auth/userinfo.profile',
  GMAIL_SEND: 'https://www.googleapis.com/auth/gmail.send',
  CALENDAR_EVENTS: 'https://www.googleapis.com/auth/calendar.events',
};

// Initial scopes requested during Google account connection
export const INITIAL_GOOGLE_SCOPES = [
  GOOGLE_SCOPES.OPENID,
  GOOGLE_SCOPES.EMAIL,
  GOOGLE_SCOPES.PROFILE,
  GOOGLE_SCOPES.GMAIL_SEND,
  GOOGLE_SCOPES.CALENDAR_EVENTS,
];

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export class GoogleService {
  constructor(private readonly googleRepo: GoogleRepository = googleRepository) {}

  /**
   * Generates a signed anti-CSRF state token for the authenticated user.
   */
  generateStateToken(userId: string): string {
    const payload: GoogleOAuthStatePayload = {
      userId,
      nonce: randomBytes(16).toString('hex'),
      timestamp: Date.now(),
    };

    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '15m' });
  }

  /**
   * Verifies and extracts the payload from a signed state token.
   */
  verifyStateToken(state: string): GoogleOAuthStatePayload {
    try {
      return jwt.verify(state, env.JWT_SECRET) as GoogleOAuthStatePayload;
    } catch (error) {
      logger.warn({ error }, 'Failed to verify Google OAuth state token');
      throw new BadRequestError('Invalid or expired OAuth state parameter', 'INVALID_OAUTH_STATE');
    }
  }

  /**
   * Initiates Google OAuth by generating the authorization URL.
   */
  getAuthorizationUrl(userId: string, scopes: string[] = INITIAL_GOOGLE_SCOPES): { url: string } {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new BadRequestError(
        'Google OAuth client is not configured on this server',
        'GOOGLE_OAUTH_NOT_CONFIGURED',
      );
    }

    const state = this.generateStateToken(userId);

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent', // Ensures refresh token is provided
      state,
    });

    return {
      url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`,
    };
  }

  /**
   * Handles the OAuth callback from Google.
   */
  async handleCallback(
    code: string | undefined,
    state: string,
    error?: string,
    errorDescription?: string,
  ): Promise<GoogleConnectionStatusResponse> {
    if (error) {
      logger.warn({ error, errorDescription }, 'Google OAuth returned error in callback');
      throw new BadRequestError(
        `Google authorization denied: ${errorDescription ?? error}`,
        'GOOGLE_AUTH_DENIED',
      );
    }

    if (!code) {
      throw new BadRequestError('Authorization code is missing from callback', 'MISSING_AUTH_CODE');
    }

    // 1. Validate State token to prevent CSRF attacks
    const statePayload = this.verifyStateToken(state);
    const userId = statePayload.userId;

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new BadRequestError(
        'Google OAuth credentials are not configured',
        'GOOGLE_OAUTH_NOT_CONFIGURED',
      );
    }

    // 2. Exchange authorization code for tokens
    const tokens = await this.exchangeCodeForTokens(code);

    // 3. Fetch Google User Profile
    const profile = await this.fetchGoogleUserProfile(tokens.access_token);

    // 4. Verify Google Account is not already linked to another application user
    const existingWithGoogleId = await this.googleRepo.findByGoogleId(profile.sub);
    if (existingWithGoogleId && existingWithGoogleId.userId !== userId) {
      throw new ConflictError(
        'This Google account is already linked to a different application user',
        'GOOGLE_ACCOUNT_ALREADY_LINKED',
      );
    }

    // 5. Encrypt tokens using AES-256-GCM
    const accessTokenEncrypted = encryptToken(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : undefined;

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const grantedScopes = tokens.scope ? tokens.scope.split(' ') : INITIAL_GOOGLE_SCOPES;

    // 6. Securely persist or update Google Account connection in Database
    const saved = await this.googleRepo.upsertConnection({
      userId,
      googleId: profile.sub,
      email: profile.email,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      scopes: grantedScopes,
    });

    logger.info(
      { userId, googleEmail: profile.email },
      'Successfully connected Google account for user',
    );

    return {
      connected: true,
      email: saved.email,
      scopes: saved.scopes,
      tokenExpiresAt: saved.tokenExpiresAt,
      connectedAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  /**
   * Retrieves current Google connection status for the authenticated user (NEVER returns tokens).
   */
  async getConnectionStatus(userId: string): Promise<GoogleConnectionStatusResponse> {
    const connection = await this.googleRepo.findByUserId(userId);

    if (!connection) {
      return {
        connected: false,
      };
    }

    return {
      connected: true,
      email: connection.email,
      scopes: connection.scopes,
      tokenExpiresAt: connection.tokenExpiresAt,
      connectedAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  /**
   * Disconnects and revokes Google account integration for the user.
   */
  async disconnect(userId: string): Promise<{ disconnected: boolean }> {
    const connection = await this.googleRepo.findByUserId(userId);

    if (!connection) {
      throw new NotFoundError('No Google account connected for this user', 'NO_GOOGLE_CONNECTION');
    }

    // Attempt to revoke tokens at Google (best effort, do not fail disconnect if token is already revoked)
    try {
      const rawToken = connection.refreshTokenEncrypted
        ? decryptToken(connection.refreshTokenEncrypted)
        : decryptToken(connection.accessTokenEncrypted);

      if (rawToken) {
        await this.revokeGoogleToken(rawToken);
      }
    } catch (revokeError) {
      logger.warn({ revokeError, userId }, 'Failed to revoke token at Google during disconnect');
    }

    await this.googleRepo.deleteByUserId(userId);

    logger.info({ userId }, 'Successfully disconnected Google account');

    return { disconnected: true };
  }

  /**
   * Retrieves a valid decrypted access token for the user, automatically refreshing it if expired.
   * Optionally verifies that a required OAuth scope is granted.
   */
  async getValidAccessToken(userId: string, requiredScope?: string): Promise<string> {
    const connection = await this.googleRepo.findByUserId(userId);

    if (!connection) {
      throw new NotFoundError('No connected Google account found for user', 'NO_GOOGLE_CONNECTION');
    }

    if (requiredScope) {
      const hasScope = connection.scopes.some(
        (s) =>
          s === requiredScope ||
          s.includes(requiredScope) ||
          (requiredScope.includes('calendar') && s.includes('calendar')) ||
          (requiredScope.includes('gmail') && s.includes('gmail')),
      );

      if (!hasScope) {
        if (requiredScope.includes('calendar') || requiredScope === GOOGLE_SCOPES.CALENDAR_EVENTS) {
          throw new ForbiddenError(
            'Google Calendar permission not granted. Please reconnect your Google account to grant calendar access.',
            'GOOGLE_CALENDAR_SCOPE_MISSING',
          );
        }
        if (requiredScope.includes('gmail') || requiredScope === GOOGLE_SCOPES.GMAIL_SEND) {
          throw new ForbiddenError(
            'Gmail permission not granted. Please reconnect your Google account to grant email sending access.',
            'GMAIL_SCOPE_MISSING',
          );
        }
        throw new ForbiddenError(
          `Required Google scope '${requiredScope}' not granted. Please reconnect your Google account.`,
          'GOOGLE_SCOPE_MISSING',
        );
      }
    }

    const now = Date.now();
    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const isExpiredOrExpiringSoon = expiresAt - now < 60 * 1000; // within 60s of expiry

    if (!isExpiredOrExpiringSoon) {
      return decryptToken(connection.accessTokenEncrypted);
    }

    // Token is expired or expiring soon, refresh it
    if (!connection.refreshTokenEncrypted) {
      throw new UnauthorizedError(
        'Google refresh token is missing. Please reconnect your Google account.',
        'GOOGLE_REFRESH_TOKEN_MISSING',
      );
    }

    const rawRefreshToken = decryptToken(connection.refreshTokenEncrypted);
    const newTokens = await this.refreshAccessToken(rawRefreshToken);

    const newAccessTokenEncrypted = encryptToken(newTokens.access_token);
    const newTokenExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);
    const newRefreshTokenEncrypted = newTokens.refresh_token
      ? encryptToken(newTokens.refresh_token)
      : connection.refreshTokenEncrypted;

    await this.googleRepo.upsertConnection({
      userId: connection.userId,
      googleId: connection.googleId,
      email: connection.email,
      accessTokenEncrypted: newAccessTokenEncrypted,
      refreshTokenEncrypted: newRefreshTokenEncrypted,
      tokenExpiresAt: newTokenExpiresAt,
      scopes: connection.scopes,
    });

    logger.info({ userId }, 'Successfully refreshed Google OAuth access token');
    return newTokens.access_token;
  }

  // ─── Protected HTTP Helper Methods (Mockable in Tests) ─────────────────────

  protected async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const bodyParams = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, 'Google token refresh failed');

      if (response.status === 400 || response.status === 401) {
        throw new UnauthorizedError(
          'Google account access has been revoked or expired. Please reconnect.',
          'GOOGLE_AUTH_REVOKED',
        );
      }

      throw new BadRequestError('Failed to refresh Google access token', 'OAUTH_REFRESH_FAILED');
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  protected async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
    const bodyParams = new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, 'Google token exchange failed');
      throw new BadRequestError(
        'Failed to exchange authorization code with Google',
        'OAUTH_EXCHANGE_FAILED',
      );
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  protected async fetchGoogleUserProfile(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, 'Google userinfo fetch failed');
      throw new BadRequestError(
        'Failed to fetch user profile from Google',
        'GOOGLE_PROFILE_FETCH_FAILED',
      );
    }

    return (await response.json()) as GoogleUserInfo;
  }

  protected async revokeGoogleToken(token: string): Promise<void> {
    try {
      await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } catch (err) {
      logger.warn({ err }, 'Google token revocation request error');
    }
  }
}

export const googleService = new GoogleService();
