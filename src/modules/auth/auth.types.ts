export interface SafeUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  totpEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterResult {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
  organization: SafeOrganization;
}

export interface StandardLoginSuccess {
  requiresMfa?: false;
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}

export interface MfaRequiredResult {
  requiresMfa: true;
  mfaToken: string;
}

export type LoginResult = StandardLoginSuccess | MfaRequiredResult;

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}
