import { prisma } from '../../../config/database.js';
import type { GoogleAccountRecord } from './google.types.js';

export interface UpsertGoogleAccountData {
  userId: string;
  googleId: string;
  email: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  tokenExpiresAt: Date;
  scopes: string[];
}

export class GoogleRepository {
  async findByUserId(userId: string): Promise<GoogleAccountRecord | null> {
    return prisma.googleAccount.findUnique({
      where: { userId },
    });
  }

  async findByGoogleId(googleId: string): Promise<GoogleAccountRecord | null> {
    return prisma.googleAccount.findUnique({
      where: { googleId },
    });
  }

  async upsertConnection(data: UpsertGoogleAccountData): Promise<GoogleAccountRecord> {
    // If refreshTokenEncrypted is provided, update it. If not provided (Google didn't return one on reconnection), keep existing.
    const existing = await this.findByUserId(data.userId);

    const refreshTokenToSave =
      data.refreshTokenEncrypted !== undefined
        ? data.refreshTokenEncrypted
        : (existing?.refreshTokenEncrypted ?? null);

    return prisma.googleAccount.upsert({
      where: { userId: data.userId },
      create: {
        userId: data.userId,
        googleId: data.googleId,
        email: data.email,
        accessTokenEncrypted: data.accessTokenEncrypted,
        refreshTokenEncrypted: data.refreshTokenEncrypted ?? null,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes,
      },
      update: {
        googleId: data.googleId,
        email: data.email,
        accessTokenEncrypted: data.accessTokenEncrypted,
        refreshTokenEncrypted: refreshTokenToSave,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes,
      },
    });
  }

  async deleteByUserId(userId: string): Promise<boolean> {
    const existing = await this.findByUserId(userId);
    if (!existing) {
      return false;
    }

    await prisma.googleAccount.delete({
      where: { userId },
    });
    return true;
  }
}

export const googleRepository = new GoogleRepository();
