import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { JwtPayload, ScopeClaims } from '@medichain/shared-types';

import { AppConfigService } from '../../../../config/app-config.service';
import { TokenExpiredError, TokenInvalidError } from '../../../../common/exceptions/domain.exception';
import { randomToken, sha256Base64, timingSafeEqualString } from '../../../../common/utils/crypto.util';
import type { TokenVerifier } from '../../../../common/ports/auth.port';

/**
 * Issues and verifies tokens.
 *
 * ## Two token types, two designs
 *
 * **Access token — a JWT.** It is verified on every request by every pod, and
 * the whole point of a JWT is that verification needs no shared state: the pod
 * checks a signature and reads the claims. A database lookup per request would
 * make the auth layer the bottleneck.
 *
 * **Refresh token — opaque random.** It is presented once per 15 minutes, so the
 * cost of a lookup is irrelevant. What matters is revocation: an opaque token can
 * be deleted from the database and is then immediately dead. A refresh JWT could
 * only be invalidated by maintaining a denylist of every revoked token until its
 * expiry — which is the same database lookup, with more moving parts and a
 * window where a revoked token still works.
 *
 * ## Why the refresh token is stored as a digest
 *
 * It carries 256 bits from the CSPRNG, so it cannot be guessed and does not need
 * a slow hash. SHA-256 is the right choice: it is fast enough to be a
 * non-issue on the hot path, and a leaked database yields digests that cannot be
 * reversed. Argon2 here would be theatre — there is no low-entropy input to
 * protect.
 *
 * ## Why `algorithms` is pinned on verify
 *
 * A JWT verifier that accepts the algorithm named in the token's own header can
 * be told `alg: none` (signature ignored) or have an RS256 token verified as
 * HS256 using the public key as the HMAC secret. Both are real, well-known
 * attacks. Pinning the list to the one algorithm we issue removes the entire
 * class.
 */
@Injectable()
export class TokenService implements TokenVerifier {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /**
   * Signs an access token.
   *
   * The payload is deliberately small. Every claim is bytes on every request, and
   * a bloated token — a full permission list for a user with fifty capabilities —
   * becomes a meaningful share of the request size at scale.
   */
  async signAccessToken(input: {
    userId: string;
    tenantId: string | null;
    organisationId: string | null;
    roles: readonly string[];
    capabilities: readonly string[];
    scope: ScopeClaims;
    sessionId: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const { accessTtlMs, issuer, audience } = this.config.jwt;
    const expiresAt = new Date(Date.now() + accessTtlMs);

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: input.userId,
      tid: input.tenantId,
      oid: input.organisationId,
      roles: input.roles,
      caps: input.capabilities,
      scp: input.scope,
      sid: input.sessionId,
    };

    const token = await this.jwt.signAsync(payload, {
      algorithm: 'HS256',
      expiresIn: Math.floor(accessTtlMs / 1_000),
      issuer,
      audience,
      // `jti` would be redundant: `sid` already identifies the session and is the
      // value the revocation check uses.
    });

    return { token, expiresAt };
  }

  /**
   * Verifies an access token and returns its claims.
   *
   * Throws rather than returning a result object. Every caller would otherwise
   * have to remember to check a `valid` flag, and the one that forgets is an
   * authentication bypass — so the failure is made impossible to ignore.
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new TokenInvalidError('No access token was supplied.');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        // Pinned. See the class note — accepting the token's own algorithm is
        // the `alg: none` and key-confusion vulnerability.
        algorithms: ['HS256'],
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
        // A small tolerance for clock skew between pods. Zero would reject
        // legitimate tokens when two pods disagree by a second; a large value
        // would extend the life of a revoked one.
        clockTolerance: 5,
      });

      // Structural validation. A correctly signed token with a missing `sid`
      // would otherwise reach the revocation check as `undefined` and be looked
      // up as a cache key of "undefined" — a subtle way to skip the check.
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        !Array.isArray(payload.roles) ||
        !Array.isArray(payload.caps)
      ) {
        throw new TokenInvalidError('The access token is missing required claims.');
      }

      return payload;
    } catch (error) {
      if (error instanceof TokenInvalidError) throw error;

      // `TokenExpiredError` is distinguished from other failures because the
      // client's correct response differs: refresh, rather than sign in again.
      const name = error instanceof Error ? error.name : '';
      if (name === 'TokenExpiredError') {
        throw new TokenExpiredError();
      }

      this.logger.debug(
        `Access token rejected: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new TokenInvalidError();
    }
  }

  /**
   * Generates an opaque refresh token and its storage digest.
   *
   * The plaintext is returned once, to be sent to the client. Only `hash` is
   * persisted. If this method is called and the plaintext is not immediately
   * written to a response, the token is unrecoverable — which is the intended
   * property, not a limitation.
   */
  generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomToken(32);
    return {
      token,
      hash: sha256Base64(token),
      expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlMs),
    };
  }

  /** Hashes a presented refresh token for lookup. Deterministic, so it is a key. */
  hashRefreshToken(token: string): string {
    return sha256Base64(token);
  }

  /**
   * Compares two token digests without leaking their difference through timing.
   *
   * The lookup itself is a unique-index hit, so this is belt and braces — but a
   * constant-time comparison costs nothing and removes the question.
   */
  tokensMatch(a: string, b: string): boolean {
    return timingSafeEqualString(a, b);
  }
}
