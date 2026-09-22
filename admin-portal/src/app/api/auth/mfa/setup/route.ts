import { ApiError, createApiClient, createAuthApi } from '@medichain/api-client';
import { NextResponse } from 'next/server';

import { isSameOrigin } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Admin BFF TOTP enrolment start.
 *
 * Forwards the sign-in challenge to `/auth/mfa/setup` and returns the pending
 * shared secret + otpauth URI. The secret never touches a third party: the
 * page renders it for manual entry into an authenticator app.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;
const SERVER_CLIENT = createApiClient({ baseUrl: API_BASE_URL, appPlatform: env.appPlatform });

interface SetupBody {
  mfaToken?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Cross-origin sign-in is not permitted.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as SetupBody | null;
  const mfaToken = typeof body?.mfaToken === 'string' && body.mfaToken !== '' ? body.mfaToken : null;
  if (mfaToken === null) {
    return NextResponse.json({ detail: 'An MFA challenge is required.' }, { status: 400 });
  }

  try {
    const setup = await createAuthApi(SERVER_CLIENT).mfaSetup({ mfaToken });
    return NextResponse.json({ data: setup });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        error.problem ?? { detail: error.message, status: error.status },
        { status: error.status },
      );
    }
    return NextResponse.json({ detail: 'Could not start enrolment.' }, { status: 502 });
  }
}
