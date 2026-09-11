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
