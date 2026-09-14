import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './constants';

/**
 * Form validation schemas.
 *
 * These mirror the backend DTOs, and they are a UX optimisation, not a control:
 * the server re-validates every field. Their job is to fail fast in the browser
 * with a message next to the offending input, instead of a round trip that
 * returns a generic 400.
 */

const identifier = z
  .string()
  .trim()
  .min(3, 'Enter your email address or phone number.')
  .max(320, 'This is too long to be an email address or phone number.');

export const loginSchema = z.object({
  identifier,
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(200),
  email: z.string().trim().email('Enter a valid email address.').max(320),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`),
  tenantCode: z.string().trim().max(32).optional(),
});

export const verifySchema = z.object({
  identifier,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the six-digit code from your email or SMS.'),
});

export const forgotPasswordSchema = z.object({ identifier });

export const resetPasswordSchema = z.object({
  identifier,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the six-digit code from your email or SMS.'),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type VerifyValues = z.infer<typeof verifySchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/**
 * Flattens zod issues into a `field -> message` map, for rendering under inputs.
 *
 * Exported so every form in the app reports errors identically; ad-hoc error
 * shapes per form are how a UI ends up with three different error styles.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    result[key] ??= issue.message;
  }
  return result;
}
