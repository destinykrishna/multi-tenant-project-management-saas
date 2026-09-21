import { z } from 'zod';

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),
  email: z.email('Invalid email address').transform((val) => val.trim().toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  organizationName: z
    .string()
    .trim()
    .min(1, 'Organization name is required')
    .max(100, 'Organization name must be at most 100 characters'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email('Invalid email address').transform((val) => val.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must be at most 128 characters'),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const verifyTotpSchema = z.object({
  code: z
    .string()
    .length(6, 'TOTP code must be exactly 6 digits')
    .regex(/^\d+$/, 'Code must be numeric'),
});
export type VerifyTotpInput = z.infer<typeof verifyTotpSchema>;

export const mfaLoginSchema = z.object({
  mfaToken: z.string().min(1, 'MFA token is required'),
  code: z
    .string()
    .length(6, 'TOTP code must be exactly 6 digits')
    .regex(/^\d+$/, 'Code must be numeric'),
});
export type MfaLoginInput = z.infer<typeof mfaLoginSchema>;

export const invitationTokenParamSchema = z.object({
  token: z.string().min(10, 'Invalid invitation token'),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(10, 'Invalid invitation token'),
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
