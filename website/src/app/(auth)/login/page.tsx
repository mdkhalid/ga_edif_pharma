'use client';

import { ApiError } from '@medichain/api-client';
import { Button, Card, CardDescription, CardHeader, CardTitle, Input, Label } from '@medichain/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { login } from '@/features/auth/api';
import { FieldMessage } from '@/features/auth/components/field-message';
import { fieldErrorsFromApi } from '@/features/auth/form-helpers';
import { fieldErrors, loginSchema } from '@/features/auth/schemas';

/**
 * Sign-in.
 *
 * A client component: it sends credentials to the BFF, which is what sets the
 * refresh cookie. The access token it gets back goes into the in-memory store.
 *
 * `next` is read from `window.location` inside the submit handler rather than with
 * `useSearchParams()`. The hook forces the route into a Suspense boundary just to
 * read one query parameter, and this page has nothing to stream.
 */
export default function LoginPage() {
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
      const outcome = await login(parsed.data);

      // Buyers are exempt from MFA, so this should not occur; surface it as a
      // form error rather than navigating as if a session existed.
      if (outcome.mfaRequired) {
        setFormError('This account requires two-factor authentication.');
        return;
      }

      const next = new URLSearchParams(window.location.search).get('next');
      router.replace(next ?? '/dashboard');
    } catch (error) {
      if (error instanceof ApiError) {
        // A registered-but-unverified account is a normal, expected state, not a
        // failure: send the user to the verification screen with the identifier
        // already filled in.
        if (error.requiresVerification) {
          router.push(`/verify?identifier=${encodeURIComponent(parsed.data.identifier)}`);
          return;
        }

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
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use the email address or phone number on your account.</CardDescription>
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
            aria-describedby={fieldError['identifier'] === undefined ? undefined : 'identifier-error'}
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
            aria-describedby={fieldError['password'] === undefined ? undefined : 'password-error'}
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

      <div className="mt-6 space-y-2 text-sm text-slate-600">
        <p>
          New here?{' '}
          <Link href="/register" className="font-medium text-brand-700 hover:underline">
            Create an account
          </Link>
        </p>
        <p>
          <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </div>
    </Card>
  );
}
