'use client';

import { ApiError } from '@medichain/api-client';
import { Button, Card, CardDescription, CardHeader, CardTitle, Input, Label } from '@medichain/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { requestContactVerification, verifyContact } from '@/features/auth/api';
import { FieldMessage } from '@/features/auth/components/field-message';
import { fieldErrorsFromApi } from '@/features/auth/form-helpers';
import { fieldErrors, verifySchema } from '@/features/auth/schemas';

/**
 * Contact verification.
 *
 * The identifier is read from the query string and applied as the input's default
 * value rather than being copied into state by an effect. Deriving it from the URL
 * keeps it in one place, and the input stays uncontrolled so the user can correct a
 * typo without the field fighting them.
 *
 * `useSearchParams` requires a Suspense boundary above it for the page to be
 * prerendered, which is why the form is split from the page — the page provides the
 * boundary.
 *
 * `devCode` is present only when the API runs outside production with
 * `AUTH_EXPOSE_OTP_IN_RESPONSE=true`. It exists so this flow is drivable without an
 * email or SMS transport; it is shown with a warning and never stored.
 */
function VerifyForm() {
  const router = useRouter();
  const identifierFromUrl = useSearchParams().get('identifier') ?? '';

  const formRef = useRef<HTMLFormElement>(null);
  const requested = useRef(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sendCode = useCallback(async (value: string): Promise<void> => {
    if (value.trim() === '') return;
    try {
      const result = await requestContactVerification(value);
      setDevCode(result.devCode ?? null);
    } catch {
      // A failed send is not fatal: the user can press "Send a new code".
    }
  }, []);

  // Guarded by a ref, not by a dependency, so React's development double-invocation
  // cannot fire two codes — the second would supersede the first.
  useEffect(() => {
    if (identifierFromUrl !== '' && !requested.current) {
      requested.current = true;
      void sendCode(identifierFromUrl);
    }
  }, [identifierFromUrl, sendCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const parsed = verifySchema.safeParse({
      identifier: String(data.get('identifier') ?? ''),
      code: String(data.get('code') ?? ''),
    });

    if (!parsed.success) {
      setFieldError(fieldErrors(parsed.error));
      return;
    }

    setFieldError({});
    setSubmitting(true);

    try {
      await verifyContact(parsed.data.identifier, parsed.data.code);
      // Sign in from the sign-in screen rather than minting a session here, so
      // there is exactly one code path that establishes a session.
      router.replace('/login?verified=1');
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

  function handleResend(): void {
    const current = formRef.current === null ? null : new FormData(formRef.current);
    void sendCode(String(current?.get('identifier') ?? identifierFromUrl));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          Enter the six-digit code we sent you. The code expires shortly and can only be used once.
        </CardDescription>
      </CardHeader>

      {devCode !== null && (
        <p className="mb-4 rounded-[var(--radius-control)] bg-warning-500/10 p-3 text-sm text-slate-700">
          <strong>Development only.</strong> No email or SMS transport is configured, so the API
          returned the code directly: <span className="font-mono">{devCode}</span>
        </p>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
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

        {formError !== null && (
          <p role="alert" className="text-sm text-danger-500">
            {formError}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full">
          Verify
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <button
          type="button"
          className="font-medium text-brand-700 hover:underline"
          onClick={handleResend}
        >
          Send a new code
        </button>
        <Link href="/login" className="text-slate-600 hover:underline">
          Back to sign in
        </Link>
      </div>
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<Card>Loading…</Card>}>
      <VerifyForm />
    </Suspense>
  );
}
