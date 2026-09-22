import { ApiError, createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin, secondsUntil } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Admin BFF TOTP enrolment confirm.
 *
 * During sign-in the backend returns the session the password step withheld
 * (`MfaEnrollmentResult`); this route sets the refresh cookie the same way the
 * password step would have, and passes the one-time recovery codes back to the
 * page. A self-service confirm while already signed in has no session to issue
 * and returns only the recovery codes.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;
const SERVER_CLIENT = createApiClient({ baseUrl: API_BASE_URL, appPlatform: env.appPlatform });

interface ConfirmBody {
  mfaToken?: unknown;
  code?: unknown;
}

function readConfirm(body: unknown): { mfaToken: string; code: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { mfaToken, code } = body as ConfirmBody;
  if (typeof mfaToken !== 'string' || mfaToken === '') return null;
  if (typeof code !== 'string' || code === '') return null;
  return { mfaToken, code };
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Cross-origin sign-in is not permitted.' }, { status: 403 });
  }

  const confirm = readConfirm(await request.json().catch(() => null));
  if (confirm === null) {
    return NextResponse.json({ detail: 'An MFA challenge and a code are required.' }, { status: 400 });
  }

  try {
    const result = await createAuthApi(SERVER_CLIENT).mfaConfirm(confirm);

    if ('tokens' in result) {
      const store = await cookies();
      store.set(
        REFRESH_COOKIE,
        result.tokens.refreshToken,
        refreshCookieOptions(
          secondsUntil(result.tokens.refreshTokenExpiresAt),
          process.env.NODE_ENV === 'production',
        ),
      );

      return NextResponse.json({
        data: {
          accessToken: result.tokens.accessToken,
          accessTokenExpiresAt: result.tokens.accessTokenExpiresAt,
          user: result.user,
          recoveryCodes: result.recoveryCodes,
        },
      });
    }

    return NextResponse.json({ data: { recoveryCodes: result.recoveryCodes } });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        error.problem ?? { detail: error.message, status: error.status },
        { status: error.status },
      );
    }
    return NextResponse.json({ detail: 'Could not confirm enrolment.' }, { status: 502 });
  }
}
