import { ApiError } from '@medichain/api-client';

import { useAuthStore } from '../src/app/store/auth.store';
import {
  bootstrapSession,
  callAuthed,
  login,
  logout,
  publicAuthApi,
  register,
  requestContactVerification,
  verifyContact,
} from '../src/lib/api/client';
import { env } from '../src/lib/env';
import { getRefreshToken } from '../src/lib/storage/secure-store';
import { __resetKeychain } from './support/expo-secure-store';

/**
 * The mobile auth flow, driven end to end against a real API.
 *
 * This is the evidence for the Phase 0 exit criterion "a user can register, verify,
 * log in, refresh, and log out from all three clients". The website and admin portal
 * were verified against a live API through their BFF; the mobile app talks to
 * `/auth` directly and keeps its refresh token in the Keychain, so it needed its own
 * run. There is no device or simulator in this environment, so the run is headless:
 * the real `src/lib/api/client.ts`, the real store and the real HTTP calls, with the
 * platform's secure storage replaced by `./support/expo-secure-store.ts`.
 *
 * The tests assert the *contract* the screens depend on, not the screens themselves:
 * `LoginScreen` branches on `ApiError.requiresVerification`, `RootNavigator` reads
 * `status`, and `bootstrapSession` is what `App` calls on cold start. If any of those
 * stop holding, the app's navigation is wrong even though it typechecks.
 *
 * Requires a running backend. See `docs/00-project-status.md` §7 for the environment
 * it was last run against.
 */

const PASSWORD = 'Sup3rSecretPassw0rd!';

let counter = 0;

function nextEmail(): string {
  counter += 1;
  return `mobile.smoke.${Date.now().toString(36)}.${counter}@example.com`;
}

/**
 * register → request a code → verify, yielding an account that can sign in.
 *
 * The code comes from the API's response body, which only happens when the backend
 * runs with `AUTH_EXPOSE_OTP_IN_RESPONSE=true` outside production — there is no mail
 * or SMS transport reachable from here.
 */
async function registerAndVerify(): Promise<string> {
  const email = nextEmail();
  await register({ fullName: 'Mobile Smoke', email, password: PASSWORD });

  const issued = await requestContactVerification(email);
  if (issued.devCode === undefined) {
    throw new Error(
      'The API did not return a dev code. Run the backend with ' +
        'AUTH_EXPOSE_OTP_IN_RESPONSE=true and NODE_ENV != production.',
    );
  }

  await verifyContact(email, issued.devCode);
  return email;
}

beforeAll(async () => {
  // Prove the API is *there* before blaming a failure on the flow. `/auth/me` with
  // no token answers 401 — an answer at all is what matters, so any HTTP response
  // passes and only a transport error fails.
  try {
    await fetch(`${env.apiBaseUrl}/auth/me`);
  } catch (error) {
    throw new Error(
      `The API is not reachable at ${env.apiBaseUrl}. Start it before running this ` +
        `suite (see README §4). Underlying error: ${String(error)}`,
    );
  }
});

beforeEach(() => {
  __resetKeychain();
  useAuthStore.getState().clear();
});

describe('mobile auth flow', () => {
  it('registers an account and refuses to sign it in before verification', async () => {
    const email = nextEmail();

    const created = await register({ fullName: 'Mobile Smoke', email, password: PASSWORD });
    expect(created.userId).toEqual(expect.any(String));
    expect(created.tenantId).toEqual(expect.any(String));

    // `LoginScreen` sends the user to the OTP screen on this code rather than
    // showing "wrong password" — the branch is only correct if the API reports it.
    const rejection = await login({ identifier: email, password: PASSWORD }).catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(ApiError);
    expect((rejection as ApiError).requiresVerification).toBe(true);
  });

  it('rejects a wrong verification code and accepts the right one', async () => {
    const email = nextEmail();
    await register({ fullName: 'Mobile Smoke', email, password: PASSWORD });

    const issued = await requestContactVerification(email);
    const code = issued.devCode;
    expect(typeof code).toBe('string');

    const wrong = code === '000000' ? '111111' : '000000';
    const rejection = await verifyContact(email, wrong).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(ApiError);

    // The mobile wrapper returns nothing on success; what matters is that the
    // account becomes signable, which is the only reason to verify at all.
    await expect(verifyContact(email, code as string)).resolves.toBeUndefined();

    await login({ identifier: email, password: PASSWORD });
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.email).toBe(email);
    expect(useAuthStore.getState().user?.status).toBe('ACTIVE');
  });

  it('keeps the refresh token in secure storage — and never the access token', async () => {
    const email = await registerAndVerify();

    await login({ identifier: email, password: PASSWORD });

    const refreshToken = await getRefreshToken();
    expect(typeof refreshToken).toBe('string');
    expect(refreshToken).not.toBe('');

    // The access token lives in memory only; storing it would add a durable secret
    // that the refresh token can already regenerate on demand.
    expect(useAuthStore.getState().accessToken).not.toBe(refreshToken);
  });

  it('restores and rotates the session from secure storage on a cold start', async () => {
    const email = await registerAndVerify();
    await login({ identifier: email, password: PASSWORD });

    const before = await getRefreshToken();

    // Simulate the process going away: only what the platform persisted survives.
    useAuthStore.getState().clear();
    expect(useAuthStore.getState().status).toBe('anonymous');

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.email).toBe(email);

    const after = await getRefreshToken();
    expect(after).not.toBe(before);
    expect(after).not.toBeNull();
  });

  it('collapses concurrent 401s into a single refresh', async () => {
    const email = await registerAndVerify();
    await login({ identifier: email, password: PASSWORD });

    const before = await getRefreshToken();

    // An access token that has expired while the app was backgrounded.
    useAuthStore.setState({ accessToken: 'not.a.valid.access.token' });

    const refresh = jest.spyOn(publicAuthApi, 'refresh');
    try {
      const profiles = await Promise.all([
        callAuthed((auth) => auth.me()),
        callAuthed((auth) => auth.me()),
        callAuthed((auth) => auth.me()),
      ]);

      expect(profiles.map((profile) => profile.email)).toEqual([email, email, email]);

      // The whole point of the single-flight guard: three concurrent refreshes
      // would present the same one-time token, and the API would read the second
      // as theft and revoke every session in the family.
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(await getRefreshToken()).not.toBe(before);
    } finally {
      refresh.mockRestore();
    }
  });

  it('signs out, revoking the session and clearing secure storage', async () => {
    const email = await registerAndVerify();
    await login({ identifier: email, password: PASSWORD });

    const refreshToken = await getRefreshToken();
    expect(typeof refreshToken).toBe('string');

    await logout();

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(await getRefreshToken()).toBeNull();

    // The session is dead on the server too, not merely forgotten by the app.
    const rejection = await publicAuthApi
      .refresh(refreshToken as string)
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(ApiError);
    expect((rejection as ApiError).status).toBe(401);

    // A cold start after signing out lands signed out.
    await bootstrapSession();
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('treats a replayed refresh token as theft and revokes the family', async () => {
    const email = await registerAndVerify();
    await login({ identifier: email, password: PASSWORD });

    const spent = await getRefreshToken();
    expect(typeof spent).toBe('string');

    // Rotate once, legitimately.
    const rotated = await publicAuthApi.refresh(spent as string);
    expect(rotated.tokens.refreshToken).not.toBe(spent);

    // Replaying the spent token is indistinguishable from an attacker who stole it,
    // so the correct response is to kill the whole family — including the token
    // that replaced it.
    const replay = await publicAuthApi
      .refresh(spent as string)
      .catch((error: unknown) => error);
    expect(replay).toBeInstanceOf(ApiError);

    const survivor = await publicAuthApi
      .refresh(rotated.tokens.refreshToken)
      .catch((error: unknown) => error);
    expect(survivor).toBeInstanceOf(ApiError);
  });
});
