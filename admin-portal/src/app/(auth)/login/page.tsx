'use client';

import { ApiError } from '@medichain/api-client';
import { Button, Card, CardDescription, CardHeader, CardTitle, Input, Label } from '@medichain/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { login } from '@/features/auth/api';
import { FieldMessage } from '@/features/auth/components/field-message';
import { fieldErrorsFromApi } from '@/features/auth/form-helpers';
import { fieldErrors, loginSchema } from '@/features/auth/schemas';

/**
 * Staff sign-in.
 *
 * There is no "create an account" or "forgot password" link: staff accounts are
 * provisioned, and a self-service reset for a back-office account is a larger
 * security decision than it looks.
 *
 * ## Known gap: MFA
 *
 * The security model calls for mandatory TOTP for every staff role. The backend has
 * no MFA implementation yet (`user.mfaEnabled` exists but nothing reads it), so this
 * screen is single-factor. That is recorded as an open item rather than pretended
 * away — see the project status document.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      identifier: String(data.get('identifier') ?? ''),
      password: String(data.get('password') ?? ''),
    });

    if (!parsed.success) {
      setFieldError(fieldErrors(parsed.error));
      return;
    }

    setFieldError({});
    setSubmitting(true);

    try {
      await login(parsed.data);
      router.replace('/dashboard');
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped = fieldErrorsFromApi(error);
        setFieldError(mapped);
        if (Object.keys(mapped).length === 0) setFormError(error.message);
      } else {
        setFormError('Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MediChain Admin</CardTitle>
        <CardDescription>Staff sign-in. This portal is not for buyer accounts.</CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <Label htmlFor="identifier">Email or phone</Label>
          <Input
            id="identifier"
            name="identifier"
            autoComplete="username"
            autoFocus
            invalid={fieldError['identifier'] !== undefined}
          />
          <FieldMessage id="identifier-error" message={fieldError['identifier']} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            invalid={fieldError['password'] !== undefined}
          />
          <FieldMessage id="password-error" message={fieldError['password']} />
        </div>

        {formError !== null && (
          <p role="alert" className="text-sm text-danger-500">
            {formError}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full">
          Sign in
        </Button>
      </form>
    </Card>
  );
}
