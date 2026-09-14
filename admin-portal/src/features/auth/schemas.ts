import { z } from 'zod';

/**
 * Staff sign-in schema.
 *
 * There is no registration schema here on purpose: staff accounts are provisioned
 * by an administrator (or seeded), never self-service. A public "create staff
 * account" endpoint would be an escalation path into the back office.
 */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, 'Enter your email address or phone number.')
    .max(320, 'This is too long to be an email address or phone number.'),
  password: z.string().min(1, 'Enter your password.').max(128),
});

export type LoginValues = z.infer<typeof loginSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    result[key] ??= issue.message;
  }
  return result;
}
