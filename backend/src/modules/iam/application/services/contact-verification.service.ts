import { Inject, Injectable, Logger } from '@nestjs/common';

import { ActorType, OtpPurpose, UserStatus } from '@medichain/shared-types';

import { requestContext } from '../../../../common/context/request-context';
import { OtpInvalidError } from '../../../../common/exceptions/domain.exception';
import { AppConfigService } from '../../../../config/app-config.service';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../../database/prisma.service';
import { UnitOfWork } from '../../../../database/unit-of-work';
import { AuditService } from '../../../audit';
import { otpDestination } from '../../domain/identifier';
import { findAccountByIdentifier } from './account-lookup';
import { PLATFORM_AUDIT_TENANT } from './auth.service';
import { OtpService } from './otp.service';

/**
 * Contact verification.
 *
 * Registration creates an account in `PENDING_VERIFICATION` and it stays there
 * until the email or phone is proven real. That is not ceremony: in this domain
 * the address is where order confirmations and prescription decisions are sent,
 * so an unverified address is a delivery that silently goes nowhere.
 *
 * The flow is two calls, intentionally. `request` issues a code; `verify` accepts
 * it and flips the account to `ACTIVE`. Splitting them means a client that loses
 * the response can ask for another code without re-registering, and it keeps the
 * "issue" path free of any account-state change.
 */

export interface VerificationRequestResult {
  readonly expiresAt: Date;
  /** Present only when `AUTH_EXPOSE_OTP_IN_RESPONSE` is on outside production. */
  readonly devCode?: string;
}

export interface VerificationResult {
  readonly userId: string;
  readonly status: UserStatus;
}

@Injectable()
export class ContactVerificationService {
  private readonly logger = new Logger(ContactVerificationService.name);

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Issues a verification code for an identifier.
   *
   * The response is identical whether the identifier belongs to a pending
   * account, an already-active one, or none at all. Differentiating would turn
   * this into an oracle for "does an account exist for this address", which is
   * the reconnaissance step before a credential-stuffing run.
   */
  async request(identifier: string): Promise<VerificationRequestResult> {
    const destination = otpDestination(identifier);

    if (destination !== null) {
      const account = await findAccountByIdentifier(this.prisma, identifier);

      // Only a pending account needs a code. An active account is already
      // verified; re-issuing would be noise, and replacing a live code with one
      // nobody asked for is worse than doing nothing.
      if (account !== null && account.status === UserStatus.PENDING_VERIFICATION) {
        const issued = await this.otp.issue({
          destination,
          purpose: OtpPurpose.VERIFY_CONTACT,
          userId: account.id,
          tenantId: account.tenantId,
        });

        return {
          expiresAt: issued.expiresAt,
          ...(this.config.authOtp.exposeInResponse ? { devCode: issued.code } : {}),
        };
      }
    }

    return { expiresAt: this.syntheticExpiry() };
  }

  /**
   * Consumes a verification code and activates the account.
   *
   * The account is resolved first only so it can be rejected cheaply; the code is
   * the thing that actually proves control of the address, and nothing is mutated
   * until `OtpService.consume` has accepted it.
   */
  async verify(identifier: string, code: string): Promise<VerificationResult> {
    const destination = otpDestination(identifier);
    if (destination === null) throw new OtpInvalidError();

    const account = await findAccountByIdentifier(this.prisma, identifier);
    if (account === null) throw new OtpInvalidError();

    const challenge = await this.otp.consume({
      destination,
      purpose: OtpPurpose.VERIFY_CONTACT,
      code,
    });

    // The destination already ties the challenge to this identifier; this is
    // defence in depth, in case a challenge was ever issued with a mismatched
    // owner.
    if (challenge.userId !== null && challenge.userId !== account.id) {
      throw new OtpInvalidError();
    }

    const verifiedAt = new Date();
    const viaEmail = destination.includes('@');

    await requestContext.withoutTenantScope(() =>
      this.uow.transaction(async (tx) => {
        await tx.user.update({
          where: { id: account.id },
          data: {
            status: UserStatus.ACTIVE,
            ...(viaEmail ? { emailVerifiedAt: verifiedAt } : { phoneVerifiedAt: verifiedAt }),
          },
        });

        // Same transaction as the change it describes, so the row exists if and
        // only if the activation committed.
        await this.audit.recordInTransaction(tx, {
          tenantId: account.tenantId ?? PLATFORM_AUDIT_TENANT,
          action: 'auth.verify.succeeded',
          entity: 'User',
          entityId: account.id,
          actorId: account.id,
          actorEmail: account.email,
          actorType: ActorType.USER,
          changes: { status: { from: account.status, to: UserStatus.ACTIVE } },
          metadata: {
            destination,
            purpose: OtpPurpose.VERIFY_CONTACT,
            via: viaEmail ? 'email' : 'phone',
          },
        });
      }),
    );

    this.logger.log(`Contact verified for user ${account.id} via ${viaEmail ? 'email' : 'phone'}.`);
    return { userId: account.id, status: UserStatus.ACTIVE };
  }

  /** A plausible expiry for a no-op response, so the shape never varies. */
  private syntheticExpiry(): Date {
    return new Date(Date.now() + this.config.authOtp.ttlMinutes * 60_000);
  }
}
