import type { ActorType } from './enums';

/**
 * Access-token claims.
 *
 * Capabilities are embedded for fast authorisation, but they are NEVER trusted
 * alone: the guard re-checks against a Redis-cached permission set keyed by
 * `sid`. Without that re-check, revoking a user's role would leave them with
 * full access until the token expired.
 */
export interface JwtPayload {
  /** User id. */
  readonly sub: string;
  /** Tenant id. Null only for the platform super-admin. */
  readonly tid: string | null;
  /** Organisation id. Null for staff users. */
  readonly oid: string | null;
  readonly roles: readonly string[];
  readonly caps: readonly string[];
  /** Attribute-based scoping — narrows which rows this principal may see. */
  readonly scp: ScopeClaims;
  /** Session id. Used for instant revocation. */
  readonly sid: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly iss?: string;
  readonly aud?: string;
}

/** ABAC attributes. Empty array means "unrestricted within the tenant". */
export interface ScopeClaims {
  readonly warehouses: readonly string[];
  readonly regions: readonly string[];
  readonly organisations: readonly string[];
}

/** The authenticated caller, resolved once per request and attached to the request context. */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly tenantId: string | null;
  readonly organisationId: string | null;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
  readonly scope: ScopeClaims;
  readonly actorType: ActorType;
}

/** Issued by login and by every successful refresh. */
export interface TokenPair {
  readonly accessToken: string;
  /** Opaque 256-bit random value. Only ever stored as a hash. */
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshTokenExpiresAt: string;
  readonly tokenType: 'Bearer';
}

/** A device the user is currently signed in on. */
export interface SessionSummary {
  readonly id: string;
  readonly deviceId: string | null;
  readonly deviceLabel: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

export interface LoginResponse {
  readonly tokens: TokenPair;
  readonly user: AuthenticatedUserProfile;
}

/**
 * Result of `POST /auth/login`.
 *
 * A discriminated union rather than a nullable `tokens` field: every existing
 * caller that does not know about MFA must fail to compile when the shape
 * changes, not discover at runtime that `tokens` is undefined. The tag is
 * always present, so a caller branches on `mfaRequired` exactly once.
 */
export type SignInResult = SignInSuccess | MfaChallenge;

/** Password accepted; a session was issued. */
export interface SignInSuccess {
  readonly mfaRequired: false;
  readonly tokens: TokenPair;
  readonly user: AuthenticatedUserProfile;
}

/**
 * Password accepted, but a second factor is owed before any session exists.
 *
 * `mfaEnrollment` distinguishes the two cases the client handles differently:
 * `false` — the account already has TOTP, ask for a code; `true` — the account
 * must enrol first (staff accounts are required to), so the client shows the
 * setup screen. `mfaToken` is a short-lived, purpose-bound JWT: it is not an
 * access token (no session id, rejected by the access-token verifier) and can
 * only be redeemed at the MFA endpoints.
 */
export interface MfaChallenge {
  readonly mfaRequired: true;
  readonly mfaToken: string;
  readonly mfaEnrollment: boolean;
  /** When the challenge expires. After this, sign in again. */
  readonly expiresAt: string;
}

/** The secret returned once by `POST /auth/mfa/setup`, before confirmation. */
export interface MfaSetupResult {
  /** Base32 shared secret — what an authenticator app scans or is pasted. */
  readonly secret: string;
  /** `otpauth://totp/…` URI for QR encoding on the client. */
  readonly otpauthUri: string;
}

/** `POST /auth/mfa/confirm` when the caller completed enrolment via a challenge. */
export interface MfaEnrollmentResult extends SignInSuccess {
  /**
   * Shown exactly once. Each may be used in place of a TOTP code at sign-in;
   * only their SHA-256 digests are stored.
   */
  readonly recoveryCodes: readonly string[];
}

/** `POST /auth/mfa/confirm` when the caller is already signed in (self-service). */
export interface MfaEnabledResult {
  readonly enabled: true;
  readonly recoveryCodes: readonly string[];
}

export interface AuthenticatedUserProfile {
  readonly id: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly fullName: string;
  readonly status: string;
  readonly tenantId: string | null;
  readonly organisationId: string | null;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
  readonly mfaEnabled: boolean;
}
