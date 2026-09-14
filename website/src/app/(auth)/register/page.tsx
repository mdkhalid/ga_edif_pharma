'use client';

import { ApiError } from '@medichain/api-client';
import { Button, Card, CardDescription, CardHeader, CardTitle, Input, Label } from '@medichain/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { register } from '@/features/auth/api';
import { FieldMessage } from '@/features/auth/components/field-message';
import { fieldErrorsFromApi } from '@/features/auth/form-helpers';
import { fieldErrors, registerSchema } from '@/features/auth/schemas';

/**
 * Registration.
 *
 * On success the account exists but is `PENDING_VERIFICATION`, so the user is sent
 * to the verification screen rather than to the app. The verification screen issues
 * the code — registration itself does not, so a dropped response never leaves a
 * user with an account they cannot activate.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      fullName: String(data.get('fullName') ?? ''),
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      tenantCode: String(data.get('tenantCode') ?? ''),
    });

    if (!parsed.success) {
      setFieldError(fieldErrors(parsed.error));
      return;
    }

    setFieldError({});
    setSubmitting(true);

    try {
      await register(parsed.data);
      router.push(`/verify?identifier=${encodeURIComponent(parsed.data.email)}`);
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
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          You will verify your email address before you can sign in.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" autoComplete="name" autoFocus />
          <FieldMessage id="fullName-error" message={fieldError['fullName']} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" name="email" type="email" autoComplete="email" />
          <FieldMessage id="email-error" message={fieldError['email']} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" />
          <p className="text-xs text-slate-500">
            At least 12 characters. A short phrase of a few words is stronger and easier to
            remember than a jumble of symbols.
          </p>
          <FieldMessage id="password-error" message={fieldError['password']} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="tenantCode">Pharma company code (optional)</Label>
          <Input id="tenantCode" name="tenantCode" placeholder="SUNRISE" />
          <FieldMessage id="tenantCode-error" message={fieldError['tenantCode']} />
        </div>

        {formError !== null && (
          <p role="alert" className="text-sm text-danger-500">
            {formError}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
