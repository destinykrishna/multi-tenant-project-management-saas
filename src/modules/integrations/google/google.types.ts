export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export interface GoogleOAuthStatePayload {
  userId: string;
  nonce: string;
  timestamp: number;
}

export interface GoogleConnectionStatusResponse {
  connected: boolean;
  email?: string;
  scopes?: string[];
  tokenExpiresAt?: Date;
  connectedAt?: Date;
  updatedAt?: Date;
}

export interface GoogleAccountRecord {
  id: string;
  userId: string;
  googleId: string;
  email: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
}
