'use client';

import { ApiError } from '@medichain/api-client';
import { Button, Card, CardDescription, CardHeader, CardTitle, Input, Label } from '@medichain/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { forgotPassword } from '@/features/auth/api';
import { FieldMessage } from '@/features/auth/components/field-message';
import { fieldErrors, forgotPasswordSchema } from '@/features/auth/schemas';

/**
 * Request a password-reset code.
 *
 * The API answers identically whether or not the account exists, so this screen
 * must not pretend to know better: it always says a code has been sent. That is not
 * a UX compromise, it is the point — a screen that said "no such account" would
 * turn this endpoint into a way to test which email addresses are registered.
 */
export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({
      identifier: String(data.get('identifier') ?? ''),
    });

    if (!parsed.success) {
      setFieldError(fieldErrors(parsed.error));
      return;
    }

    setFieldError({});
    setSubmitting(true);

    try {
      const result = await forgotPassword(parsed.data);
      setDevCode(result.devCode ?? null);
      setSentTo(parsed.data.identifier);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo !== null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            If an account exists for <span className="font-medium">{sentTo}</span>, a reset code is
            on its way. It expires shortly and can only be used once.
          </CardDescription>
        </CardHeader>

        {devCode !== null && (
          <p className="mb-4 rounded-[var(--radius-control)] bg-warning-500/10 p-3 text-sm text-slate-700">
            <strong>Development only.</strong> The API returned the code directly:{' '}
            <span className="font-mono">{devCode}</span>
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Link href={`/reset-password?identifier=${encodeURIComponent(sentTo)}`}>
            <Button className="w-full">Enter the code</Button>
          </Link>
          <Link href="/login" className="text-center text-sm text-slate-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>We will send a one-time code to your email or phone.</CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <Label htmlFor="identifier">Email or phone</Label>
          <Input id="identifier" name="identifier" autoComplete="username" autoFocus />
          <FieldMessage id="identifier-error" message={fieldError['identifier']} />
        </div>

        {formError !== null && (
          <p role="alert" className="text-sm text-danger-500">
            {formError}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full">
          Send reset code
        </Button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
