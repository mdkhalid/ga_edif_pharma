import { Inject, Injectable, Logger } from '@nestjs/common';

import { ActorType, OtpPurpose, SessionRevokedReason } from '@medichain/shared-types';

import { requestContext } from '../../../../common/context/request-context';
import { OtpInvalidError } from '../../../../common/exceptions/domain.exception';
import { AppConfigService } from '../../../../config/app-config.service';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../../database/prisma.service';
import { UnitOfWork } from '../../../../database/unit-of-work';
import { AuditService } from '../../../audit';
import { otpDestination } from '../../domain/identifier';
import { Password } from '../../domain/value-objects/password.vo';
import { findAccountByIdentifier } from './account-lookup';
import { PLATFORM_AUDIT_TENANT } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * Self-service password reset.
 *
 * Two calls against a one-time code: `forgot` issues it, `reset` consumes it and
 * replaces the password. Kept apart from sign-in rather than folded into
 * `AuthService`, because a reset does two things a sign-in never does — it
 * rewrites the credential and it terminates every existing session — and those
 * deserve to be the whole of a small service rather than a branch of a large one.
 *
 * ## No account enumeration
 *
 * `forgot` answers identically for a known and an unknown identifier. The
 * alternative — a helpful "no such account" — turns the endpoint into a way to
 * confirm which of a leaked address list are real users.
 */

export interface PasswordResetRequestResult {
  readonly expiresAt: Date;
  /** Present only when `AUTH_EXPOSE_OTP_IN_RESPONSE` is on outside production. */
  readonly devCode?: string;
}

export interface PasswordResetResult {
  readonly reset: boolean;
  readonly revokedSessions: number;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly otp: OtpService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Issues a reset code.
   *
   * Deliberately does **not** reveal whether the account exists. It also does not
   * refuse to issue when it does not — the response is the same either way, so the
   * caller learns nothing.
   */
  async forgot(identifier: string): Promise<PasswordResetRequestResult> {
    const destination = otpDestination(identifier);

    if (destination !== null) {
      const account = await findAccountByIdentifier(this.prisma, identifier);

      if (account !== null) {
        const issued = await this.otp.issue({
          destination,
          purpose: OtpPurpose.RESET_PASSWORD,
          userId: account.id,
          tenantId: account.tenantId,
        });

        return {
          expiresAt: issued.expiresAt,
          ...(this.config.authOtp.exposeInResponse ? { devCode: issued.code } : {}),
        };
      }
    }

    return { expiresAt: new Date(Date.now() + this.config.authOtp.ttlMinutes * 60_000) };
  }

  /**
   * Consumes a reset code and replaces the password.
   *
   * ## The order of the three expensive steps is the design
   *
   *   1. Policy validation — **cheap and pure**, and runs first so a password the
   *      policy will never accept does not burn the code.
   *   2. Code consumption — proves the caller controls the contact address.
   *   3. Password hashing — **expensive**, and runs only after the code is
   *      accepted, so an unauthenticated caller cannot force argon2 work and turn
   *      this into a CPU-exhaustion lever.
   *
   * Hashing before step 2 would be the obvious implementation and the wrong one:
   * it lets anyone who can POST to the endpoint make the server do 19 MiB of work
   * per request without presenting a valid code.
   */
  async reset(input: {
    identifier: string;
    code: string;
    newPassword: string;
  }): Promise<PasswordResetResult> {
    const destination = otpDestination(input.identifier);
    if (destination === null) throw new OtpInvalidError();

    const account = await findAccountByIdentifier(this.prisma, input.identifier);
    if (account === null) throw new OtpInvalidError();

    // 1. Policy check. Reuses the same value object and rules as sign-up, so the
    //    reset path cannot be a way to install a password registration would
    //    have rejected.
    const password = Password.create(input.newPassword, [
      account.email ?? '',
      account.phone ?? '',
      ...account.fullName.split(/\s+/),
    ]);

    // 2. Prove control of the address.
    const challenge = await this.otp.consume({
      destination,
      purpose: OtpPurpose.RESET_PASSWORD,
      code: input.code,
    });

    if (challenge.userId !== null && challenge.userId !== account.id) {
      throw new OtpInvalidError();
    }

    // 3. Only now is it safe to spend the CPU.
    const passwordHash = await this.passwords.hash(password);
    const changedAt = new Date();

    await requestContext.withoutTenantScope(() =>
      this.uow.transaction(async (tx) => {
        await tx.user.update({
          where: { id: account.id },
          data: {
            passwordHash,
            passwordChangedAt: changedAt,
            // A reset is also the way out of a lockout: the legitimate owner has
            // just proved control of the address, so the counters start clean.
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });

        await this.audit.recordInTransaction(tx, {
          tenantId: account.tenantId ?? PLATFORM_AUDIT_TENANT,
          action: 'auth.password.reset',
          entity: 'User',
          entityId: account.id,
          actorId: account.id,
          actorEmail: account.email,
          actorType: ActorType.USER,
          metadata: { purpose: OtpPurpose.RESET_PASSWORD },
        });
      }),
    );

    // Every existing session dies, including any the attacker holds. A stolen
    // password is useless if the sessions it established cannot outlive the reset.
    const revokedSessions = await this.sessions.revokeAllForUser(
      account.id,
      SessionRevokedReason.PASSWORD_CHANGED,
    );

    this.logger.log(
      `Password reset for user ${account.id}; revoked ${revokedSessions} session(s).`,
    );

    return { reset: true, revokedSessions };
  }
}
