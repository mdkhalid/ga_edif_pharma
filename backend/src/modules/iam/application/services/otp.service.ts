import { Inject, Injectable, Logger } from '@nestjs/common';

import type { OtpPurpose } from '@medichain/shared-types';

import { requestContext } from '../../../../common/context/request-context';
import {
  OtpAttemptsExceededError,
  OtpExpiredError,
  OtpInvalidError,
} from '../../../../common/exceptions/domain.exception';
import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../../../../common/ports/notification.port';
import { randomNumericCode, sha256Hex, timingSafeEqualString } from '../../../../common/utils/crypto.util';
import { AppConfigService } from '../../../../config/app-config.service';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../../database/prisma.service';
import { UnitOfWork } from '../../../../database/unit-of-work';

/**
 * One-time codes: issue and consume.
 *
 * ## What this service is, and is not
 *
 * It owns the *mechanism* of a one-time challenge — generate, store as a digest,
 * expire, cap attempts, consume once. It does not know what a code is *for*:
 * verifying a contact, resetting a password and (later) a passwordless sign-in all
 * call the same two methods with a different `purpose`. The flows that decide what
 * happens after a code is accepted live next to this service.
 *
 * ## Why the code is stored only as a digest
 *
 * `sha256Hex(code)` is what lands in `otp_challenge.code_hash`. A code has 10^6
 * possible values, so a plain digest is brute-forceable offline in milliseconds —
 * which is why the digest alone is not the protection. The protections are that
 * the code is single-use (`consumedAt`), short-lived (`expiresAt`), attempt-capped
 * (`maxAttempts`), and only ever valid for one destination and purpose. A leaked
 * database yields a digest that has usually already expired.
 *
 * ## Why a code is superseded rather than allowed to accumulate
 *
 * Issuing a new code marks every outstanding challenge for the same
 * destination+purpose as consumed. Without it, "request a new code" leaves the old
 * code live, so the window during which *any* of several emailed codes works keeps
 * widening — the opposite of what a user asking for a fresh code expects.
 */

export const OTP_CODE_LENGTH = 6;

export interface IssueOtpInput {
  /** Email address or phone number, already canonicalised. */
  readonly destination: string;
  readonly purpose: OtpPurpose;
  /** The account the challenge is for, when one is known at issue time. */
  readonly userId: string | null;
  readonly tenantId: string | null;
}

export interface IssuedOtp {
  readonly code: string;
  readonly expiresAt: Date;
}

export interface ConsumedOtp {
  readonly id: string;
  readonly userId: string | null;
  readonly tenantId: string | null;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Creates a challenge and delivers the code.
   *
   * The delivery happens *after* the transaction commits, deliberately. A
   * notification is a side effect, and the unit of work retries a conflicting
   * transaction by re-running its callback from scratch — sending inside the
   * callback would deliver the same code twice on a retry, and worse, would
   * deliver a code for a challenge that rolled back and does not exist.
   */
  async issue(input: IssueOtpInput): Promise<IssuedOtp> {
    const { ttlMinutes, maxAttempts } = this.config.authOtp;
    const code = randomNumericCode(OTP_CODE_LENGTH);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    await requestContext.withoutTenantScope(() =>
      this.uow.transaction(async (tx) => {
        // Supersede any outstanding code for this destination+purpose, so exactly
        // one code is ever live per destination.
        await tx.otpChallenge.updateMany({
          where: { destination: input.destination, purpose: input.purpose, consumedAt: null },
          data: { consumedAt: new Date() },
        });

        await tx.otpChallenge.create({
          data: {
            tenantId: input.tenantId,
            userId: input.userId,
            purpose: input.purpose,
            destination: input.destination,
            codeHash: sha256Hex(code),
            maxAttempts,
            expiresAt,
          },
        });
      }),
    );

    await this.notifications.sendOtp({
      destination: input.destination,
      purpose: input.purpose,
      code,
      expiresInMinutes: ttlMinutes,
    });

    return { code, expiresAt };
  }

  /**
   * Verifies a code and consumes it.
   *
   * Returns the challenge's owner so the caller can act on it. Verification is
   * ordered so the cheapest, least revealing failures come first, and the attempt
   * counter is incremented atomically — a read-then-write would let parallel
   * guesses both see `attempts: 4` and hand an attacker twice the budget, which is
   * precisely how an automated attack behaves.
   */
  async consume(input: {
    destination: string;
    purpose: OtpPurpose;
    code: string;
  }): Promise<ConsumedOtp> {
    return requestContext.withoutTenantScope(async () => {
      const challenge = await this.prisma.otpChallenge.findFirst({
        where: {
          destination: input.destination,
          purpose: input.purpose,
          consumedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          tenantId: true,
          codeHash: true,
          attempts: true,
          maxAttempts: true,
          expiresAt: true,
        },
      });

      // No live challenge: never requested, already used, or superseded by a
      // newer code. All one answer.
      if (challenge === null) throw new OtpInvalidError();

      if (challenge.expiresAt.getTime() <= Date.now()) throw new OtpExpiredError();

      if (challenge.attempts >= challenge.maxAttempts) throw new OtpAttemptsExceededError();

      // Constant-time comparison. The stored value is a digest, so both sides are
      // re-hashed by the helper — the equality is what matters, and doing it in
      // constant time costs nothing.
      const matches = timingSafeEqualString(sha256Hex(input.code), challenge.codeHash);

      if (!matches) {
        const updated = await this.prisma.otpChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
          select: { attempts: true, maxAttempts: true },
        });

        // The increment that exhausts the budget reports the cap, not a generic
        // mismatch, so the client knows to request a new code rather than retry.
        if (updated.attempts >= updated.maxAttempts) throw new OtpAttemptsExceededError();
        throw new OtpInvalidError();
      }

      // Atomic single-use claim. `consumedAt: null` in the WHERE clause makes this
      // a compare-and-set, so two requests presenting the same code race and
      // exactly one wins — the loser sees `count === 0` and is rejected.
      const claimed = await this.prisma.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      if (claimed.count === 0) {
        this.logger.warn(`A one-time code for ${input.destination} was consumed concurrently.`);
        throw new OtpInvalidError();
      }

      return { id: challenge.id, userId: challenge.userId, tenantId: challenge.tenantId };
    });
  }
}
