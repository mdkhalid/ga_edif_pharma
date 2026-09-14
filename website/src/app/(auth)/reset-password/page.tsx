'use client';

import { ApiError } from '@medichain/api-client';
import { Button, Card, CardDescription, CardHeader, CardTitle, Input, Label } from '@medichain/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { resetPassword } from '@/features/auth/api';
import { FieldMessage } from '@/features/auth/components/field-message';
import { fieldErrorsFromApi } from '@/features/auth/form-helpers';
import { fieldErrors, resetPasswordSchema } from '@/features/auth/schemas';

/**
 * Consume a reset code and set a new password.
 *
 * The API has already revoked every existing session — on every device — by the time
 * this succeeds, so the user is sent to sign in rather than being logged in here.
 * Silently establishing a session would hide the fact that other devices were signed
 * out, which is exactly the thing the user needs to know.
 *
 * The identifier comes from the query string as an input default rather than being
 * mirrored into state, so there is no effect and no cascading render.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const identifierFromUrl = useSearchParams().get('identifier') ?? '';
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const parsed = resetPasswordSchema.safeParse({
      identifier: String(data.get('identifier') ?? ''),
      code: String(data.get('code') ?? ''),
      newPassword: String(data.get('newPassword') ?? ''),
    });

    if (!parsed.success) {
      setFieldError(fieldErrors(parsed.error));
      return;
    }

    setFieldError({});
    setSubmitting(true);

    try {
      await resetPassword(parsed.data);
      router.replace('/login?reset=1');
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped = fieldErrorsFromApi(error);
        setFieldError(mapped);
        if (Object.keys(mapped).length === 0) setFormError(error.message);
      } else {
        setFormError('Something went wrong. Try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          Enter the code we sent you and your new password. Every device will be signed out.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <Label htmlFor="identifier">Email or phone</Label>
          <Input
            id="identifier"
            name="identifier"
            defaultValue={identifierFromUrl}
            autoComplete="username"
          />
          <FieldMessage id="identifier-error" message={fieldError['identifier']} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="code">Six-digit code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            invalid={fieldError['code'] !== undefined}
          />
          <FieldMessage id="code-error" message={fieldError['code']} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="newPassword">New password</Label>
          <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" />
          <p className="text-xs text-slate-500">At least 12 characters.</p>
          <FieldMessage id="newPassword-error" message={fieldError['newPassword']} />
        </div>

        {formError !== null && (
          <p role="alert" className="text-sm text-danger-500">
            {formError}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full">
          Set new password
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card>Loading…</Card>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
