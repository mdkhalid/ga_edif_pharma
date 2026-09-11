import type { ActorType, JwtPayload } from '@medichain/shared-types';

/**
 * Ports the authentication guards depend on.
 *
 * The guards live in `common/`; the JWT implementation and the session store
 * live in `modules/iam/`. If the guard imported the IAM service directly,
 * `common` would depend on a feature module and the dependency would run
 * backwards — the first step towards the cycle that makes a monolith
 * unextractable.
 *
 * Declaring the interface here inverts that: `common` owns the contract it
 * needs, IAM provides the adapter, and the DI token below is the only coupling.
 * A future extracted auth service satisfies the same interface over HTTP.
 */

export const TOKEN_VERIFIER = Symbol('TokenVerifier');
export const SESSION_AUTHORITY = Symbol('SessionAuthority');

export interface TokenVerifier {
  /**
   * Verifies signature, expiry, issuer and audience.
   *
   * Throws `TokenExpiredError` or `TokenInvalidError` — it never returns a
   * partial payload for a bad token, because every caller would then have to
   * remember to check a `valid` flag, and one that forgets is an auth bypass.
   */
  verifyAccessToken(token: string): Promise<JwtPayload>;
}

/**
 * The authoritative answer to "may this token still be used, and what may it
 * do right now?".
 *
 * This exists because claims in a JWT are a *snapshot* taken when it was
 * signed. Between issuance and expiry the user may be suspended, their role
 * changed, or their session revoked from another device. Honouring the token
 * alone means those changes take up to 15 minutes to take effect — which for
 * "we just blocked this distributor for fraud" is 15 minutes too many.
 *
 * The implementation caches the answer in Redis keyed by session id and
 * invalidates on change, so the check costs a single Redis round trip on the
 * hot path rather than a database query.
 */
export interface SessionAuthority {
  /**
   * Returns the current grant for a verified token, or `null` when the session
   * is unknown, revoked, or past its absolute expiry.
   *
   * `null` is a normal outcome, not an error: a revoked session is exactly what
   * this method is here to detect.
   */
  resolveAccessGrant(payload: JwtPayload): Promise<AccessGrant | null>;
}

export interface AccessGrant {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly organisationId: string | null;
  /** Roles as they stand now, which may differ from the token's claims. */
  readonly roles: readonly string[];
  /** Capabilities as they stand now. */
  readonly capabilities: readonly string[];
  readonly actorType: ActorType;
}

/** Cache-key helper shared by the authority implementation and its invalidator. */
export const sessionGrantCacheKey = (sessionId: string): string => `session:grant:${sessionId}`;
