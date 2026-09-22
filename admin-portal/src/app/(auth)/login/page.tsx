'use client';

import { ApiError } from '@medichain/api-client';
import type { MfaSetupResult } from '@medichain/shared-types';
import { Button, Card, CardDescription, CardHeader, CardTitle, Input, Label } from '@medichain/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { login, mfaConfirm, mfaLogin, mfaSetup, type LoginOutcome } from '@/features/auth/api';
import { FieldMessage } from '@/features/auth/components/field-message';
import { fieldErrorsFromApi } from '@/features/auth/form-helpers';
import { fieldErrors, loginSchema, mfaCodeSchema } from '@/features/auth/schemas';

/**
 * Staff sign-in.
 *
 * There is no "create an account" or "forgot password" link: staff accounts are
 * provisioned, and a self-service reset for a back-office account is a larger
 * security decision than it looks.
 *
 * Three steps, driven by the `SignInResult` union rather than by guesswork:
 *
 * 1. **password** — credentials go to the BFF; either a session is issued or an
 *    MFA challenge comes back.
 * 2. **enrol** — first sign-in for a staff account: fetch the pending TOTP
 *    secret, show it for manual entry into an authenticator app, confirm with a
 *    code, then display recovery codes exactly once.
 * 3. **code** — subsequent sign-ins: a TOTP or recovery code redeems the
 *    challenge and the BFF sets the refresh cookie.
 *
 * The secret is rendered as base32 text and an `otpauth://` URI rather than a
 * QR image: no third party may see the secret, and adding a QR encoder is a
 * deliberate dependency decision, not a requirement for enrolment to work —
 * every authenticator app supports manual entry.
 */

type Step =
  | { name: 'password' }
  | { name: 'enrol'; mfaToken: string; setup: MfaSetupResult }
  | { name: 'code'; mfaToken: string };

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);

  function reportError(error: unknown): void {
    if (error instanceof ApiError) {
      const mapped = fieldErrorsFromApi(error);
      setFieldError(mapped);
      if (Object.keys(mapped).length === 0) setFormError(error.message);
    } else {
      setFormError('Something went wrong. Try again.');
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
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
      const outcome: LoginOutcome = await login(parsed.data);

      if (!outcome.mfaRequired) {
        router.replace('/dashboard');
        return;
      }

      if (outcome.mfaEnrollment) {
        const setup = await mfaSetup(outcome.mfaToken);
        setStep({ name: 'enrol', mfaToken: outcome.mfaToken, setup });
      } else {
        setStep({ name: 'code', mfaToken: outcome.mfaToken });
      }
    } catch (error) {
      reportError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnrol(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (step.name !== 'enrol') return;

    const data = new FormData(event.currentTarget);
    const parsed = mfaCodeSchema.safeParse(String(data.get('code') ?? ''));

    if (!parsed.success) {
      setFieldError({ code: parsed.error.issues[0]?.message ?? 'Enter your code.' });
      return;
    }

    setFieldError({});
    setSubmitting(true);

    try {
      const { recoveryCodes: codes } = await mfaConfirm(step.mfaToken, parsed.data);
      setRecoveryCodes(codes);
    } catch (error) {
      reportError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (step.name !== 'code') return;

    const data = new FormData(event.currentTarget);
    const parsed = mfaCodeSchema.safeParse(String(data.get('code') ?? ''));

    if (!parsed.success) {
      setFieldError({ code: parsed.error.issues[0]?.message ?? 'Enter your code.' });
      return;
    }

    setFieldError({});
    setSubmitting(true);

    try {
      await mfaLogin(step.mfaToken, parsed.data);
      router.replace('/dashboard');
    } catch (error) {
      reportError(error);
    } finally {
      setSubmitting(false);
    }
  }

  function restart(): void {
    setStep({ name: 'password' });
    setFieldError({});
    setFormError(null);
    setRecoveryCodes(null);
  }

  if (recoveryCodes !== null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Save your recovery codes</CardTitle>
          <CardDescription>
            Each code can be used once in place of your authenticator app. They are shown only
            this once — store them somewhere safe before continuing.
          </CardDescription>
        </CardHeader>

        <div className="space-y-4">
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {recoveryCodes.map((code) => (
              <li key={code} className="rounded bg-slate-100 px-2 py-1 text-center">
                {code}
              </li>
            ))}
          </ul>

          <Button type="button" className="w-full" onClick={() => router.replace('/dashboard')}>
            Continue to dashboard
          </Button>
        </div>
      </Card>
    );
  }

  if (step.name === 'enrol') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set up two-factor authentication</CardTitle>
          <CardDescription>
            Add this account to an authenticator app, then enter the six-digit code it shows.
          </CardDescription>
        </CardHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Secret key</Label>
            <p className="break-all rounded bg-slate-100 px-3 py-2 font-mono text-sm">
              {step.setup.secret}
            </p>
            <p className="text-xs text-slate-600">
              Enter this key manually in your authenticator app (Google Authenticator, Authy,
              1Password, etc.).
            </p>
          </div>

          <div className="space-y-1">
            <Label>Setup URI</Label>
            <p className="break-all rounded bg-slate-100 px-3 py-2 font-mono text-xs">
              {step.setup.otpauthUri}
            </p>
          </div>

          <form onSubmit={handleEnrol} className="space-y-4" noValidate>
            <div className="space-y-1">
              <Label htmlFor="code">Authentication code</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                invalid={fieldError['code'] !== undefined}
              />
              <FieldMessage id="code-error" message={fieldError['code']} />
            </div>

            {formError !== null && (
              <p role="alert" className="text-sm text-danger-500">
                {formError}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={restart}>
                Back
              </Button>
              <Button type="submit" loading={submitting} className="flex-1">
                Confirm and continue
              </Button>
            </div>
          </form>
        </div>
      </Card>
    );
  }

  if (step.name === 'code') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Enter the six-digit code from your authenticator app, or a recovery code.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleCode} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="code">Authentication code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              invalid={fieldError['code'] !== undefined}
            />
            <FieldMessage id="code-error" message={fieldError['code']} />
          </div>

          {formError !== null && (
            <p role="alert" className="text-sm text-danger-500">
              {formError}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={restart}>
              Back
            </Button>
            <Button type="submit" loading={submitting} className="flex-1">
              Verify
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MediChain Admin</CardTitle>
        <CardDescription>Staff sign-in. This portal is not for buyer accounts.</CardDescription>
      </CardHeader>

      <form onSubmit={handlePassword} className="space-y-4" noValidate>
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
