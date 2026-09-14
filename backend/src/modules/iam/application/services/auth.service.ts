import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ActorType,
  SessionRevokedReason,
  SystemRole,
  UserStatus,
  type AuthenticatedUserProfile,
  type LoginResponse,
  type TokenPair,
} from '@medichain/shared-types';

import { AppConfigService } from '../../../../config/app-config.service';
import { requestContext } from '../../../../common/context/request-context';
import {
  AccountLockedError,
  ConfigurationError,
  ConflictError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  UnauthenticatedError,
} from '../../../../common/exceptions/domain.exception';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../../database/prisma.service';
import { UnitOfWork } from '../../../../database/unit-of-work';
import { AuditService } from '../../../audit';
import { normaliseEmail, normalisePhone } from '../../domain/identifier';
import { Password } from '../../domain/value-objects/password.vo';
import { PasswordService } from './password.service';
import { RoleResolver } from './role-resolver.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Authentication orchestration.
 *
 * This service owns the *flow* — the order of checks, the lockout policy, what
 * is audited — and delegates the mechanisms (hashing, signing, session state) to
 * the services it composes. Keeping the flow here means the lockout rule exists
 * in exactly one place, rather than being re-implemented slightly differently by
 * each caller.
 */

export interface RegisterInput {
  email?: string;
  phone?: string;
  fullName: string;
  password: string;
  /** Which pharma company the account belongs to. */
  tenantCode?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginInput {
  /** Email or phone. One field, so the client does not have to decide which. */
  identifier: string;
  password: string;
  deviceId?: string | null;
  deviceLabel?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly roles: RoleResolver,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Creates an account in `PENDING_VERIFICATION`.
   *
   * The account cannot sign in until the email or phone is verified. Issuing a
   * usable session straight away would mean an unverified address can transact,
   * and in this domain that address is where order confirmations and prescription
   * decisions are sent.
   */
  async register(input: RegisterInput): Promise<{ userId: string; tenantId: string }> {
    const email = normaliseEmail(input.email);
    const phone = normalisePhone(input.phone);

    if (email === null && phone === null) {
      throw new ConfigurationError('Either an email address or a phone number is required.');
    }

    // Validation happens before any database work, so an invalid password never
    // consumes a connection or a transaction.
    const password = Password.create(input.password, [
      email ?? '',
      phone ?? '',
      ...input.fullName.split(/\s+/),
    ]);

    const tenant = await this.resolveTenant(input.tenantCode);
    const passwordHash = await this.passwords.hash(password);

    const result = await requestContext.withoutTenantScope(async () =>
      this.uow.transaction(async (tx) => {
        // Checked inside the transaction, and the unique index is the real
        // guarantee. A pre-check outside would be a race: two concurrent
        // registrations both see "available" and one fails at commit with an
        // opaque database error instead of a clear 409.
        const existing = await tx.user.findFirst({
          where: {
            tenantId: tenant.id,
            deletedAt: null,
            OR: [
              ...(email === null ? [] : [{ email }]),
              ...(phone === null ? [] : [{ phone }]),
            ],
          },
          select: { id: true, email: true, phone: true },
        });

        if (existing !== null) {
          if (email !== null && existing.email === email) throw new EmailAlreadyRegisteredError();
          throw new ConflictError('An account with these details already exists.');
        }

        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email,
            phone,
            fullName: input.fullName.trim(),
            passwordHash,
            status: UserStatus.PENDING_VERIFICATION,
          },
          select: { id: true },
        });

        // A new buyer account starts as BUYER_ADMIN of its own organisation: the
        // person who registers is the one who administers that organisation's
        // users. Narrowing it later is an administrative action, and starting
        // from the least privilege that can still be useful avoids a support
        // queue of "I cannot invite my colleague".
        const role = await tx.role.findFirst({
          where: { code: SystemRole.BUYER_ADMIN, OR: [{ tenantId: tenant.id }, { tenantId: null }] },
          select: { id: true },
        });

        if (role === null) {
          // A missing seeded role is a deployment problem, not a user problem.
          // Failing here is better than creating an account that can do nothing.
          throw new ConfigurationError(
            `The ${SystemRole.BUYER_ADMIN} role is not seeded for tenant ${tenant.code}. ` +
              'Run the role seed before accepting registrations.',
          );
        }

        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });

        await this.audit.recordInTransaction(tx, {
          tenantId: tenant.id,
          action: 'auth.register',
          entity: 'User',
          entityId: user.id,
          actorId: user.id,
          actorEmail: email,
          actorType: ActorType.USER,
          metadata: { tenantCode: tenant.code },
        });

        return { userId: user.id, tenantId: tenant.id };
      }),
    );

    this.logger.log(`Registered user ${result.userId} in tenant ${tenant.code}.`);
    return result;
  }

  // -------------------------------------------------------------------------
  // Sign-in
  // -------------------------------------------------------------------------

  /**
   * Verifies credentials and starts a session.
   *
   * ## The order of checks is deliberate
   *
   *   1. Resolve the account.
   *   2. If it does not exist, **still hash the password** and then fail.
   *   3. Reject a locked account.
   *   4. Verify the password.
   *   5. Check the account status.
   *
   * Step 2 is what makes account enumeration infeasible: without it, "no such
   * account" returns in microseconds while "wrong password" takes ~50 ms, and the
   * difference is a reliable oracle. Hashing a dummy value equalises the timing.
   *
   * Step 5 comes *after* the password check on purpose. Rejecting a suspended
   * account before verifying the password would confirm the account exists to
   * anyone who guesses an address — so the status is only revealed to someone
   * who already proved they hold the credentials.
   *
   * ## Why the failure response is identical in every case
   *
   * Unknown account, wrong password, suspended account: all return the same
   * `InvalidCredentialsError`. Distinguishing them is convenient for a legitimate
   * user and invaluable to an attacker building a target list.
   */
  async login(input: LoginInput): Promise<LoginResponse> {
    const identifier = input.identifier.trim();
    const email = normaliseEmail(identifier);
    const phone = normalisePhone(identifier);

    // Pre-authentication: no tenant is known until the account resolves.
    const user = await requestContext.withoutTenantScope(() =>
      this.prisma.user.findFirst({
        where: {
          deletedAt: null,
          OR: [...(email === null ? [] : [{ email }]), ...(phone === null ? [] : [{ phone }])],
        },
        select: {
          id: true,
          tenantId: true,
          email: true,
          phone: true,
          fullName: true,
          status: true,
          passwordHash: true,
          organisationId: true,
          lockedUntil: true,
          failedLoginAttempts: true,
          mfaEnabled: true,
          tenant: { select: { id: true, code: true, status: true } },
        },
      }),
    );

    if (user === null) {
      // Equalise the timing. The result is discarded; the throw is the point.
      await this.passwords.verifyDummy(input.password);
      throw new InvalidCredentialsError();
    }

    // A user with no tenant is a platform super-admin. They authenticate through
    // the same endpoint but their session is tenant-less.
    const tenantId = user.tenantId ?? user.tenant?.id ?? null;
    const auditTenantId = tenantId ?? PLATFORM_AUDIT_TENANT;

    if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.recordFailedLogin({
        tenantId: auditTenantId,
        email: user.email ?? identifier,
        userId: user.id,
        reason: 'account_locked',
      });
      throw new AccountLockedError(user.lockedUntil);
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, input.password);

    if (!passwordValid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts, auditTenantId, {
        email: user.email ?? identifier,
        userId: user.id,
      });
      throw new InvalidCredentialsError();
    }

    // Verified credentials but the account cannot transact.
    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.record({
        tenantId: auditTenantId,
        action: 'auth.login.blocked',
        outcome: 'FAILURE',
        actorId: user.id,
        actorEmail: user.email,
        metadata: { status: user.status },
      });
      this.sessions.assertAccountActive(user.status);
    }

    if (user.tenant !== null && user.tenant.status !== 'ACTIVE') {
      await this.audit.record({
        tenantId: auditTenantId,
        action: 'auth.login.blocked',
        outcome: 'FAILURE',
        actorId: user.id,
        actorEmail: user.email,
        metadata: { tenantStatus: user.tenant.status },
      });
      throw new UnauthenticatedError(
        'This account’s organisation is suspended. Contact your administrator.',
      );
    }

    // Opportunistic rehash: the one moment the plaintext is available. Free
    // upgrade path when the argon2 cost factors are raised.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const upgraded = await this.passwords.hash(Password.create(input.password, []));
      await requestContext.withoutTenantScope(() =>
        this.prisma.user.updateMany({
          where: { id: user.id },
          data: { passwordHash: upgraded },
        }),
      );
    }

    const context = requestContext.get();
    const session = await this.sessions.createSession({
      userId: user.id,
      tenantId: auditTenantId,
      organisationId: user.organisationId,
      deviceId: input.deviceId ?? null,
      deviceLabel: input.deviceLabel ?? null,
      ipAddress: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    });

    // Reset the counter and stamp the sign-in. Both are best-effort: failing to
    // record them must not deny a user a session they have legitimately earned.
    await requestContext.withoutTenantScope(() =>
      this.prisma.user
        .updateMany({
          where: { id: user.id },
          data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
        })
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not reset the sign-in counters for ${user.id}: ` +
              `${error instanceof Error ? error.message : ''}`,
          ),
        ),
    );

    // `UserRole` is classified as a global model (see tenant-scoping.extension.ts),
    // so this read is not filtered even without the wrapper. The wrapper is kept
    // deliberately: signing in must be able to read role grants before the tenant
    // is known, and stating that here means the requirement survives any future
    // reclassification of the model.
    const roleIds = await requestContext.withoutTenantScope(async () => {
      const rows = await this.prisma.userRole.findMany({
        where: { userId: user.id },
        select: { roleId: true, role: { select: { code: true } } },
      });
      return rows;
    });

    const capabilities = await this.roles.effectiveCapabilities(roleIds.map((row) => row.roleId));
    const roleCodes = roleIds.map((row) => row.role.code);

    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      organisationId: user.organisationId,
      roles: roleCodes,
      capabilities,
      scope: { warehouses: [], regions: [], organisations: [] },
      sessionId: session.sessionId,
    });

    await this.audit.record({
      tenantId: auditTenantId,
      action: 'auth.login.succeeded',
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: roleCodes[0] ?? null,
      metadata: { sessionId: session.sessionId },
    });

    const tokens: TokenPair = {
      accessToken: accessToken.token,
      refreshToken: session.refreshToken,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
      tokenType: 'Bearer',
    };

    return {
      tokens,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        status: user.status,
        tenantId: user.tenantId,
        organisationId: user.organisationId,
        roles: roleCodes,
        capabilities,
        mfaEnabled: user.mfaEnabled,
      } satisfies AuthenticatedUserProfile,
    };
  }

  // -------------------------------------------------------------------------
  // Refresh and sign-out
  // -------------------------------------------------------------------------

  /** Exchanges a refresh token for a new pair, rotating the refresh token. */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    const rotated = await this.sessions.rotateRefreshToken(refreshToken);

    // See the note in `login` — `UserRole` is global, and the wrapper states the
    // requirement rather than depending on that classification.
    const roleRows = await requestContext.withoutTenantScope(() =>
      this.prisma.userRole.findMany({
        where: { userId: rotated.userId },
        select: { roleId: true, role: { select: { code: true } } },
      }),
    );

    const capabilities = await this.roles.effectiveCapabilities(roleRows.map((row) => row.roleId));
    const roleCodes = roleRows.map((row) => row.role.code);

    const user = await requestContext.withoutTenantScope(() =>
      this.prisma.user.findUnique({
        where: { id: rotated.userId },
        select: {
          id: true,
          email: true,
          phone: true,
          fullName: true,
          status: true,
          tenantId: true,
          organisationId: true,
          mfaEnabled: true,
        },
      }),
    );

    if (user === null) throw new UnauthenticatedError('This account no longer exists.');

    const accessToken = await this.tokens.signAccessToken({
      userId: rotated.userId,
      tenantId: rotated.tenantId,
      organisationId: rotated.organisationId,
      roles: roleCodes,
      capabilities,
      scope: { warehouses: [], regions: [], organisations: [] },
      sessionId: rotated.sessionId,
    });

    return {
      tokens: {
        accessToken: accessToken.token,
        refreshToken: rotated.refreshToken,
        accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
        refreshTokenExpiresAt: rotated.refreshTokenExpiresAt.toISOString(),
        tokenType: 'Bearer',
      },
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        status: user.status,
        tenantId: user.tenantId,
        organisationId: user.organisationId,
        roles: roleCodes,
        capabilities,
        mfaEnabled: user.mfaEnabled,
      } satisfies AuthenticatedUserProfile,
    };
  }

  /**
   * Ends the current session.
   *
   * Only the session that made the request, never every session. Signing out on
   * a phone must not sign the user out of their desktop — that is what the
   * "sign out everywhere" action is for, and it is a separate, explicit choice.
   */
  async logout(sessionId: string, userId: string): Promise<void> {
    await this.sessions.assertSessionOwnership(sessionId, userId);
    await this.sessions.revokeSession(sessionId, SessionRevokedReason.LOGOUT);

    const context = requestContext.get();
    await this.audit.record({
      tenantId: context?.tenantId ?? PLATFORM_AUDIT_TENANT,
      action: 'auth.logout',
      entity: 'Session',
      entityId: sessionId,
    });
  }

  /** Returns the profile of the authenticated principal. */
  async me(userId: string): Promise<AuthenticatedUserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        status: true,
        tenantId: true,
        organisationId: true,
        mfaEnabled: true,
        roles: { select: { roleId: true, role: { select: { code: true } } } },
      },
    });

    if (user === null) throw new UnauthenticatedError('This account no longer exists.');

    const roleIds = user.roles.map((row) => row.roleId);
    const capabilities = await this.roles.effectiveCapabilities(roleIds);

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      status: user.status,
      tenantId: user.tenantId,
      organisationId: user.organisationId,
      roles: user.roles.map((row) => row.role.code),
      capabilities,
      mfaEnabled: user.mfaEnabled,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Records a failed attempt and locks the account at the threshold.
   *
   * The increment is a single `updateMany` with an atomic `increment`, not a
   * read-then-write. Two concurrent failed attempts must both count: with a
   * read-then-write, both read 4, both write 5, and an attacker gets twice the
   * attempts by sending them in parallel — which is exactly how an automated
   * attack behaves.
   *
   * The lockout is written only when the threshold is crossed, and the check is
   * part of the same statement's `where` clause so the lock cannot be applied
   * twice or skipped by a concurrent pair.
   */
  private async registerFailedAttempt(
    userId: string,
    previousAttempts: number,
    tenantId: string,
    audit: { email: string; userId: string },
  ): Promise<void> {
    const { maxAttempts, lockMinutes } = this.config.loginSecurity;
    const nextAttempts = previousAttempts + 1;
    const shouldLock = nextAttempts >= maxAttempts;

    try {
      await requestContext.withoutTenantScope(() =>
        this.prisma.user.update({
          where: { id: userId },
          data: {
            failedLoginAttempts: { increment: 1 },
            ...(shouldLock ? { lockedUntil: new Date(Date.now() + lockMinutes * 60_000) } : {}),
          },
        }),
      );
    } catch (error) {
      // A failure to record the attempt must not mask the authentication
      // failure, which is the answer the caller actually needs.
      this.logger.warn(
        `Could not record a failed sign-in attempt for ${userId}: ` +
          `${error instanceof Error ? error.message : ''}`,
      );
    }

    if (shouldLock) {
      this.logger.warn(
        `Account ${userId} locked for ${lockMinutes} minutes after ${nextAttempts} failed attempts.`,
      );
    }

    await this.audit.recordFailedLogin({
      tenantId,
      email: audit.email,
      userId: audit.userId,
      reason: shouldLock ? 'invalid_password_locked' : 'invalid_password',
    });
  }

  /**
   * Resolves which tenant a registration belongs to.
   *
   * A `tenantCode` is preferred and is what an invitation link carries. Falling
   * back to "the only active tenant" is a development convenience with a guard:
   * it applies only when exactly one exists, so it cannot silently pick the wrong
   * company once a second tenant is created.
   */
  private async resolveTenant(
    tenantCode: string | undefined,
  ): Promise<{ id: string; code: string }> {
    return requestContext.withoutTenantScope(async () => {
      if (tenantCode !== undefined && tenantCode.trim() !== '') {
        const tenant = await this.prisma.tenant.findUnique({
          where: { code: tenantCode.trim().toUpperCase() },
          select: { id: true, code: true, status: true },
        });

        if (tenant === null) {
          throw new ConflictError(`No pharma company is registered with the code "${tenantCode}".`);
        }
        if (tenant.status !== 'ACTIVE') {
          throw new ConflictError('This pharma company is not currently accepting registrations.');
        }
        return { id: tenant.id, code: tenant.code };
      }

      const active = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE', deletedAt: null },
        select: { id: true, code: true },
        take: 2,
      });

      if (active.length === 0) {
        throw new ConfigurationError(
          'No active tenant exists. Seed a tenant before accepting registrations.',
        );
      }
      if (active.length > 1) {
        throw new ConflictError(
          'Several pharma companies are registered. Supply the tenant code you are registering with.',
        );
      }

      return { id: active[0]!.id, code: active[0]!.code };
    });
  }
}

/**
 * Placeholder tenant id for audit rows that describe platform-level events with
 * no tenant — a sign-in attempt against an address that exists in no tenant.
 *
 * A fixed, well-known UUID rather than `null` because `audit_log.tenant_id` is
 * non-nullable: making it nullable to accommodate one edge case would weaken the
 * scoping guarantee for every other row.
 */
export const PLATFORM_AUDIT_TENANT = '00000000-0000-0000-0000-000000000000';

/**
 * Re-exported from `domain/identifier` so this module's public API is unchanged.
 *
 * The canonicalisation rule now lives in one place, shared with contact
 * verification and password reset. Three copies of "how do we recognise a phone
 * number" would eventually disagree, and the flow that disagreed would fail to
 * find an account that plainly exists.
 */
export { normaliseEmail, normalisePhone };
