import type {
  AuthenticatedUserProfile,
  LoginResponse,
  SessionSummary,
} from '@medichain/shared-types';

import { unwrap, unwrapVoid, type MediChainClient } from '../client';

/**
 * Auth endpoints.
 *
 * A thin typed layer over the generated client. It exists because the generated
 * client cannot know two things the contract does not describe: the `{ data: … }`
 * success envelope, and the response body types (the spec models request DTOs
 * only). Both come from `@medichain/shared-types`, so there is one definition of
 * `LoginResponse` in the repository.
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
  login(body: LoginRequest): Promise<LoginResponse>;
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
      return unwrap<LoginResponse>(await client.POST('/auth/login', { body }));
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
  };
}
