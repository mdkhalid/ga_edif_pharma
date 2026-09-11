import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ActorType,
  SessionRevokedReason,
  UserStatus,
  type JwtPayload,
} from '@medichain/shared-types';

import { requestContext } from '../../../../common/context/request-context';
import {
  AccountNotVerifiedError,
  RefreshTokenReuseError,
  TokenExpiredError,
  TokenInvalidError,
  UnauthenticatedError,
} from '../../../../common/exceptions/domain.exception';
import {
  sessionGrantCacheKey,
  type AccessGrant,
  type SessionAuthority,
} from '../../../../common/ports/auth.port';
import { CACHE_TTL, CacheNamespace, cacheKey } from '../../../../infra/cache/cache-keys';
import { CacheService } from '../../../../infra/cache/cache.service';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../../database/prisma.service';
import { UnitOfWork } from '../../../../database/unit-of-work';
import { AuditService } from '../../../audit';
import { RoleResolver } from './role-resolver.service';
import { TokenService } from './token.service';

/**
 * Session lifecycle: creation, rotation, revocation, and the authoritative
 * access check.
 *
 * ## Refresh-token rotation and why reuse detection matters
 *
 * Every refresh issues a new refresh token and marks the old one used. The old
 * token remains in the table, marked — that row is the whole mechanism.
 *
 * If a token that has already been used is presented again, one of two things
 * happened:
 *
 *   - the legitimate client lost the response and retried, or
 *   - an attacker copied the token and is using it alongside the real client.
 *
 * The two are indistinguishable, and the second is far more costly. So the
 * response is the same for both: revoke the entire token family and force a
 * fresh sign-in. In the first case the user is mildly inconvenienced. In the
 * second, the attacker's stolen token chain dies immediately — and critically,
 * the *legitimate* client's next refresh also fails, which is the signal that
 * surfaces the compromise.
 *
 * The alternative — silently issuing a new token — leaves the attacker with a
 * permanent, self-renewing session that no one will ever notice.
 *
 * ## Why the claim is a compare-and-set, not a read-then-write
 *
 * Two concurrent refreshes with the same token both read `usedAt: null` and both
 * proceed under a naive implementation, producing two valid chains from one
 * token. The `updateMany` with `usedAt: null` in the `where` clause is a single
 * atomic statement: exactly one caller updates one row, and the loser sees
 * `count === 0`. That loser is, by definition, reuse.
 */
@Injectable()
export class SessionService implements SessionAuthority {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly tokens: TokenService,
    private readonly roles: RoleResolver,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  /**
   * Creates a session and its first refresh token.
   *
   * Callers are unauthenticated at this point (sign-in) or acting on a session
   * that is being replaced, so this always runs without tenant scope — the tenant
   * is an input here, not something the context can supply.
   */
  async createSession(input: {
    userId: string;
    tenantId: string;
    organisationId: string | null;
    deviceId?: string | null;
    deviceLabel?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    /** Reuses an existing family when rotating; a new family otherwise. */
    familyId?: string;
  }): Promise<{ sessionId: string; refreshToken: string; refreshTokenExpiresAt: Date }> {
    const { token, hash, expiresAt } = this.tokens.generateRefreshToken();
    const sessionId = randomUUID();

    // A session's absolute expiry equals its refresh token's. The token can be
    // rotated indefinitely, but never past this instant — which is what stops a
    // stolen chain from living forever.
    await this.uow.transaction(async (tx) => {
      await tx.session.create({
        data: {
          id: sessionId,
          tenantId: input.tenantId,
          userId: input.userId,
          deviceId: input.deviceId ?? null,
          deviceLabel: input.deviceLabel ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          familyId: input.familyId ?? randomUUID(),
          expiresAt,
        },
      });

      await tx.refreshToken.create({
        data: {
          tenantId: input.tenantId,
          sessionId,
          tokenHash: hash,
          expiresAt,
        },
      });
    });

    return { sessionId, refreshToken: token, refreshTokenExpiresAt: expiresAt };
  }

  // -------------------------------------------------------------------------
  // Rotation
  // -------------------------------------------------------------------------

  /**
   * Exchanges a refresh token for a new pair.
   *
   * Returns the identifiers the caller needs to mint a fresh access token. The
   * access token is signed by the caller (`AuthService`) rather than here, so
   * this service stays responsible for session state and nothing else.
   */
  async rotateRefreshToken(presentedToken: string): Promise<{
    sessionId: string;
    userId: string;
    tenantId: string;
    organisationId: string | null;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  }> {
    if (typeof presentedToken !== 'string' || presentedToken.trim() === '') {
      throw new TokenInvalidError('A refresh token is required.');
    }

    const tokenHash = this.tokens.hashRefreshToken(presentedToken);

    // No principal exists yet — the access token has expired — so the lookup
    // cannot be tenant-scoped. This is the one deliberate unscoped read in the
    // authentication flow, and it is safe because the lookup key is an
    // unguessable 256-bit digest: there is no way to enumerate another tenant's
    // tokens, and the tenant is derived from the row that is found.
    return requestContext.withoutTenantScope(async () => {
      const existing = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: { session: true },
      });

      if (existing === null) {
        // Unknown token. Nothing to revoke — we cannot identify a family — so
        // this is a plain rejection.
        throw new TokenInvalidError('This refresh token is not recognised.');
      }

      // Reuse detected before any state change: decisive and cheap.
      if (existing.usedAt !== null) {
        await this.revokeFamily(existing.sessionId, SessionRevokedReason.REUSE_DETECTED);
        // Audited before throwing: this is the strongest signal the system
        // produces that a refresh token has been stolen, and the request that
        // triggers it ends in a 401 with nothing else recorded.
        await this.audit.recordRefreshReuse({
          tenantId: existing.session.tenantId,
          userId: existing.session.userId,
          sessionId: existing.sessionId,
          detection: 'pre_check',
        });
        throw new RefreshTokenReuseError();
      }

      const now = new Date();

      if (existing.session.revokedAt !== null) {
        throw new UnauthenticatedError('This session has been revoked. Sign in again.');
      }

      if (existing.expiresAt <= now || existing.session.expiresAt <= now) {
        throw new TokenExpiredError();
      }

      const nextTokenId = randomUUID();
      const next = this.tokens.generateRefreshToken();

      let lostRace = false;

      try {
        await this.uow.transaction(async (tx) => {
          // The atomic claim. `usedAt: null` in the WHERE clause is what makes
          // this a compare-and-set: only one concurrent caller can match.
          const claimed = await tx.refreshToken.updateMany({
            where: { id: existing.id, usedAt: null },
            data: { usedAt: now },
          });

          if (claimed.count === 0) {
            lostRace = true;
            // Throwing rolls back, which is correct: the loser must not leave a
            // half-rotated state. The family revocation happens after the
            // rollback, outside this transaction.
            throw new Error('refresh-rotation-lost-race');
          }

          await tx.refreshToken.create({
            data: {
              id: nextTokenId,
              tenantId: existing.tenantId,
              sessionId: existing.sessionId,
              tokenHash: next.hash,
              expiresAt: next.expiresAt,
            },
          });

          // Records the chain so an investigation can follow it after a reuse
          // alert. Without this the history is a set of disconnected rows.
          await tx.refreshToken.update({
            where: { id: existing.id },
            data: { replacedByTokenId: nextTokenId },
          });

          await tx.session.update({
            where: { id: existing.sessionId },
            data: { lastUsedAt: now },
          });
        });
      } catch (error) {
        if (lostRace) {
          // A concurrent request rotated this same token first. From the
          // system's perspective that is indistinguishable from replay, and the
          // safe response is identical.
          this.logger.warn(
            `Concurrent refresh detected for session ${existing.sessionId}; ` +
              'revoking the token family.',
          );
          await this.revokeFamily(existing.sessionId, SessionRevokedReason.REUSE_DETECTED);
          await this.audit.recordRefreshReuse({
            tenantId: existing.session.tenantId,
            userId: existing.session.userId,
            sessionId: existing.sessionId,
            detection: 'lost_race',
          });
          throw new RefreshTokenReuseError();
        }
        throw error;
      }

      // The old grant is stale the moment the token rotates.
      await this.cache.invalidate(sessionGrantCacheKey(existing.sessionId));

      const user = await this.prisma.user.findUnique({
        where: { id: existing.session.userId },
        select: { organisationId: true },
      });

      return {
        sessionId: existing.sessionId,
        userId: existing.session.userId,
        tenantId: existing.tenantId,
        organisationId: user?.organisationId ?? null,
        refreshToken: next.token,
        refreshTokenExpiresAt: next.expiresAt,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  /** Revokes one session. Idempotent: revoking an already-revoked session is a no-op. */
  async revokeSession(sessionId: string, reason: SessionRevokedReason): Promise<void> {
    await requestContext.withoutTenantScope(async () => {
      await this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
    });

    // The cache entry is what the guard reads on every request. Leaving it would
    // keep the session usable for up to its TTL — which is precisely the window
    // revocation exists to close.
    await this.cache.invalidate(sessionGrantCacheKey(sessionId));
  }

  /**
   * Revokes every session in a token family.
   *
   * Called on reuse detection. Deliberately revokes the family rather than the
   * single session: the point is to terminate the chain an attacker may be
   * holding, including the descendant tokens that were issued legitimately
   * before the theft was noticed.
   */
  async revokeFamily(sessionId: string, reason: SessionRevokedReason): Promise<void> {
    await requestContext.withoutTenantScope(async () => {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { familyId: true, userId: true },
      });
      if (session === null) return;

      const family = await this.prisma.session.findMany({
        where: { familyId: session.familyId, revokedAt: null },
        select: { id: true },
      });

      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });

      await Promise.all(
        family.map((entry) => this.cache.invalidate(sessionGrantCacheKey(entry.id))),
      );

      this.logger.warn(
        `Revoked ${family.length} session(s) in family ${session.familyId} for user ` +
          `${session.userId} (${reason}).`,
      );
    });
  }

  /**
   * Revokes every session for a user.
   *
   * Used on password change and by an administrator forcing a sign-out. There is
   * no option to keep the current session: a password change is a security
   * event, and "keep me signed in on this device" is exactly the assumption an
   * attacker relies on.
   */
  async revokeAllForUser(userId: string, reason: SessionRevokedReason): Promise<number> {
    return requestContext.withoutTenantScope(async () => {
      const active = await this.prisma.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true },
      });

      await this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });

      await Promise.all(active.map((entry) => this.cache.invalidate(sessionGrantCacheKey(entry.id))));
      return active.length;
    });
  }

  // -------------------------------------------------------------------------
  // Authoritative access check (SessionAuthority)
  // -------------------------------------------------------------------------

  /**
   * Resolves the current grant for a verified access token.
   *
   * This is the second stage of authentication: the signature proves the token is
   * ours, and this proves it is still *allowed*. The result is cached for a short
   * TTL and invalidated on any change, so the common case costs one Redis read.
   *
   * Returns `null` — never throws — for a session that is revoked, expired, or
   * belongs to a non-active user. `null` is the normal answer to "may this token
   * still be used?", and making it an exception would encourage callers to catch
   * and continue.
   */
  async resolveAccessGrant(payload: JwtPayload): Promise<AccessGrant | null> {
    const cacheKeyValue = sessionGrantCacheKey(payload.sid);

    const cached = await this.cache.get<AccessGrant>(cacheKeyValue);
    if (cached !== undefined) return cached;

    const grant = await requestContext.withoutTenantScope(async () => {
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        include: {
          user: {
            select: {
              id: true,
              status: true,
              tenantId: true,
              organisationId: true,
              passwordChangedAt: true,
              deletedAt: true,
              roles: { select: { roleId: true, role: { select: { code: true } } } },
            },
          },
        },
      });

      if (session === null) return null;
      if (session.revokedAt !== null) return null;

      const now = Date.now();
      if (session.expiresAt.getTime() <= now) return null;

      const user = session.user;
      if (user === null || user.deletedAt !== null) return null;

      // A suspended or deactivated user must lose access immediately, not when
      // their access token expires. This is the check that makes that true.
      if (user.status !== UserStatus.ACTIVE) return null;

      // Password change invalidates every token issued before it. Comparing
      // against the token's own `iat` needs no extra state and no denylist:
      // a token minted before the change is rejected, one minted after is fine.
      if (user.passwordChangedAt !== null && payload.iat !== undefined) {
        const passwordChangedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1_000);
        // One second of tolerance for the gap between minting the token and
        // writing `passwordChangedAt` in the same flow.
        if (passwordChangedAtSeconds > payload.iat + 1) return null;
      }

      const roleIds = user.roles.map((entry) => entry.roleId);
      const capabilities = await this.roles.effectiveCapabilities(roleIds);

      return {
        sessionId: session.id,
        userId: user.id,
        tenantId: user.tenantId,
        organisationId: user.organisationId,
        // Read from the database, not from the token: a role removed five
        // minutes ago must not still be in effect.
        roles: user.roles.map((entry) => entry.role.code),
        capabilities,
        actorType: ActorType.USER,
      } satisfies AccessGrant;
    });

    // Negative results are cached too, and with a shorter TTL: caching a revoked
    // session for the full window would slow the propagation of a *reinstated*
    // one, which is the less dangerous direction but still a support burden.
    if (grant === null) {
      await this.cache.set(cacheKeyValue, null, 30);
      return null;
    }

    await this.cache.set(cacheKeyValue, grant, CACHE_TTL.SESSION_GRANT);
    return grant;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Lists a user's active sessions for the "your devices" screen. */
  async listActiveSessions(userId: string): Promise<
    Array<{
      id: string;
      deviceId: string | null;
      deviceLabel: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: Date;
      expiresAt: Date;
    }>
  > {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceId: true,
        deviceLabel: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /** Guards against a session being revoked by a different user. */
  async assertSessionOwnership(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (session === null) {
      // NotFound rather than Forbidden: confirming that a session id belongs to
      // someone else would leak the existence of another user's session.
      throw new TokenInvalidError('Session not found.');
    }
  }

  /** Helper used by the sign-in flow to reject unverified accounts. */
  assertAccountActive(status: UserStatus): void {
    if (status === UserStatus.PENDING_VERIFICATION) throw new AccountNotVerifiedError();
    if (status !== UserStatus.ACTIVE) {
      throw new UnauthenticatedError('This account is not active. Contact your administrator.');
    }
  }

  /** Exposed for the audit trail: the cache key a grant lives under. */
  grantCacheKey(sessionId: string): string {
    return cacheKey(CacheNamespace.SESSION_GRANT, sessionId);
  }
}
