import type {
  AuthenticatedUserProfile,
  LoginResponse,
  MfaEnabledResult,
  MfaEnrollmentResult,
  MfaSetupResult,
  SessionSummary,
  SignInResult,
  SignInSuccess,
} from '@medichain/shared-types';

import { unwrap, unwrapVoid, type MediChainClient } from '../client';

/**
 * Auth endpoints.
 *
 * A thin typed layer over the generated client. It exists because the generated
 * client cannot know two things the contract does not describe: the `{ data: … }`
 * success envelope, and the response body types (the spec models request DTOs
 * only). Both come from `@medichain/shared-types`, so there is one definition of
 * `SignInResult` / `LoginResponse` in the repository.
 */

export interface RegisterRequest {
  readonly email?: string;
  readonly phone?: string;
  readonly fullName: string;
  readonly password: string;
  readonly tenantCode?: string;
}

export interface RegisterResult {
  readonly userId: string;
  readonly tenantId: string;
}

export interface LoginRequest {
  readonly identifier: string;
  readonly password: string;
  readonly deviceId?: string;
  readonly deviceLabel?: string;
}

export interface OtpRequestResult {
  readonly expiresAt: string;
  /**
   * The code, echoed back only when the server runs with
   * `AUTH_EXPOSE_OTP_IN_RESPONSE=true` outside production. Never present in a real
   * environment; do not display it as if it were.
   */
  readonly devCode?: string;
}

export interface PasswordResetResult {
  readonly reset: boolean;
  readonly revokedSessions: number;
}

export interface AuthApi {
  /** Requires an `Idempotency-Key`, so a retry cannot create a second account. */
  register(body: RegisterRequest, idempotencyKey: string): Promise<RegisterResult>;
  /**
   * Returns `SignInResult`: either a full session (`mfaRequired: false`) or an
   * MFA challenge (`mfaRequired: true`) to redeem at `mfaLogin` (or enrol via
   * `mfaSetup` + `mfaConfirm`).
   */
  login(body: LoginRequest): Promise<SignInResult>;
  refresh(refreshToken: string): Promise<LoginResponse>;
  logout(): Promise<void>;
  me(): Promise<AuthenticatedUserProfile>;
  listSessions(): Promise<readonly SessionSummary[]>;
  requestContactVerification(identifier: string): Promise<OtpRequestResult>;
  verifyContact(identifier: string, code: string): Promise<{ userId: string; status: string }>;
  forgotPassword(identifier: string): Promise<OtpRequestResult>;
  resetPassword(body: {
    identifier: string;
    code: string;
    newPassword: string;
  }): Promise<PasswordResetResult>;

  // ------------------------------------------------------------------- MFA
  /**
   * Start TOTP enrolment. Pass the challenge's `mfaToken` during staff enrolment
   * from sign-in, or omit it when setting up from an authenticated session.
   * Returns the pending base32 secret and `otpauth://` URI (shown/encoded once).
   */
  mfaSetup(body: { mfaToken?: string }): Promise<MfaSetupResult>;
  /**
   * Confirm enrolment with a code from the authenticator app. Enables MFA and
   * returns recovery codes (single display). When called with the sign-in
   * challenge, also returns the session the password step withheld.
   */
  mfaConfirm(body: { mfaToken?: string; code: string }): Promise<MfaEnrollmentResult | MfaEnabledResult>;
  /**
   * Redeem an MFA challenge (from `login`) with a TOTP or recovery code and
   * complete sign-in.
   */
  mfaLogin(body: { mfaToken: string; code: string; deviceId?: string; deviceLabel?: string }): Promise<SignInSuccess>;
  /**
   * Turn off TOTP. Requires a live code even though the caller is signed in —
   * a stolen session disabling the second factor is the attack MFA stops.
   */
  mfaDisable(body: { code: string }): Promise<{ enabled: false }>;
}

export function createAuthApi(client: MediChainClient): AuthApi {
  return {
    async register(body, idempotencyKey) {
      return unwrap<RegisterResult>(
        await client.POST('/auth/register', {
          body,
          // openapi-fetch groups path/query/header/cookie under `params`, and the
          // spec marks this header required — so a caller cannot forget it and
          // still compile.
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
    },

    async login(body) {
      return unwrap<SignInResult>(await client.POST('/auth/login', { body }));
    },

    async refresh(refreshToken) {
      return unwrap<LoginResponse>(
        await client.POST('/auth/refresh', { body: { refreshToken } }),
      );
    },

    async logout() {
      return unwrapVoid(await client.POST('/auth/logout', {}));
    },

    async me() {
      return unwrap<AuthenticatedUserProfile>(await client.GET('/auth/me', {}));
    },

    async listSessions() {
      return unwrap<readonly SessionSummary[]>(await client.GET('/auth/sessions', {}));
    },

    async requestContactVerification(identifier) {
      return unwrap<OtpRequestResult>(
        await client.POST('/auth/verify/request', { body: { identifier } }),
      );
    },

    async verifyContact(identifier, code) {
      return unwrap<{ userId: string; status: string }>(
        await client.POST('/auth/verify', { body: { identifier, code } }),
      );
    },

    async forgotPassword(identifier) {
      return unwrap<OtpRequestResult>(
        await client.POST('/auth/password/forgot', { body: { identifier } }),
      );
    },

    async resetPassword(body) {
      return unwrap<PasswordResetResult>(
        await client.POST('/auth/password/reset', { body }),
      );
    },

    async mfaSetup(body) {
      return unwrap<MfaSetupResult>(
        await client.POST('/auth/mfa/setup', { body }),
      );
    },

    async mfaConfirm(body) {
      return unwrap<MfaEnrollmentResult | MfaEnabledResult>(
        await client.POST('/auth/mfa/confirm', { body }),
      );
    },

    async mfaLogin(body) {
      return unwrap<SignInSuccess>(
        await client.POST('/auth/mfa/login', { body }),
      );
    },

    async mfaDisable(body) {
      return unwrap<{ enabled: false }>(
        await client.POST('/auth/mfa/disable', { body }),
      );
    },
  };
}
