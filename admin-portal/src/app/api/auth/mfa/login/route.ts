import { ApiError, createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin, secondsUntil } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Admin BFF second-factor sign-in.
 *
 * Redeems the short-lived MFA challenge from `/api/auth/login` with a TOTP code
 * or a recovery code. On success the refresh token is set exactly as the
 * password step would have set it — the session simply starts one round later.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;
const SERVER_CLIENT = createApiClient({ baseUrl: API_BASE_URL, appPlatform: env.appPlatform });

interface MfaLoginBody {
  mfaToken?: unknown;
  code?: unknown;
}

function readChallenge(body: unknown): { mfaToken: string; code: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { mfaToken, code } = body as MfaLoginBody;
  if (typeof mfaToken !== 'string' || mfaToken === '') return null;
  if (typeof code !== 'string' || code === '') return null;
  return { mfaToken, code };
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Cross-origin sign-in is not permitted.' }, { status: 403 });
  }

  const challenge = readChallenge(await request.json().catch(() => null));
  if (challenge === null) {
    return NextResponse.json(
      { detail: 'An MFA challenge and a code are required.' },
      { status: 400 },
    );
  }

  try {
    const session = await createAuthApi(SERVER_CLIENT).mfaLogin(challenge);
    const store = await cookies();

    store.set(
      REFRESH_COOKIE,
      session.tokens.refreshToken,
      refreshCookieOptions(
        secondsUntil(session.tokens.refreshTokenExpiresAt),
        process.env.NODE_ENV === 'production',
      ),
    );

    return NextResponse.json({
      data: {
        accessToken: session.tokens.accessToken,
        accessTokenExpiresAt: session.tokens.accessTokenExpiresAt,
        user: session.user,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        error.problem ?? { detail: error.message, status: error.status },
        { status: error.status },
      );
    }
    return NextResponse.json({ detail: 'Sign-in failed. Try again.' }, { status: 502 });
  }
}
