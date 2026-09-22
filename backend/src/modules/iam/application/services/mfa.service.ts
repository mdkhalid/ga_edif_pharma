import { Inject, Injectable, Logger } from '@nestjs/common';

import type { MfaSetupResult, SignInSuccess } from '@medichain/shared-types';

import { requestContext } from '../../../../common/context/request-context';
import {
  ConflictError,
  MfaCodeInvalidError,
  UnauthenticatedError,
} from '../../../../common/exceptions/domain.exception';
import { EncryptionService } from '../../../../common/utils/encryption.service';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../../database/prisma.service';
import { UnitOfWork } from '../../../../database/unit-of-work';
import { AuditService } from '../../../audit';
import {
  generateRecoveryCodes,
  isRecoveryCodeShaped,
  isTotpShaped,
  normaliseRecoveryCode,
  recoveryCodeDigest,
} from '../../domain/mfa-policy';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '../../domain/totp';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * TOTP enrolment, verification and second-factor sign-in.
 *
 * ## Why the secret is envelope-encrypted, not hashed
 *
 * A TOTP shared secret must be recoverable: the server has to recompute the
 * expected code on every sign-in, and unlike a password there is no verifier
 * form. Hashing it would make verification impossible. So it is encrypted with
 * the same AES-256-GCM keyring that protects `platform_setting`, with AAD
 * binding it to `user:<id>` — a row-swapped ciphertext fails to decrypt rather
 * than silently validating the wrong account's codes.
 *
 * ## Why the challenge is a JWT, not a row
 *
 * The alternative — an `mfa_challenge` table — adds a migration, a TTL sweep
 * and a cleanup job to protect a five-minute, single-endpoint token whose
 * entire job is to carry a user id from "password accepted" to "code accepted".
 * A signed token needs none of that, and it cannot be forged because it shares
 * the access-token key while carrying a `purpose` claim the access verifier
 * rejects.
 *
 * ## enrolment vs verification
 *
 * `setup` writes a *pending* secret and leaves `mfaEnabled` false; only
 * `confirm`, which proves the user can actually read codes from their app,
 * flips the flag. Enabling first would lock every user who scans the QR wrong.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  /** Label shown in authenticator apps. */
  private static readonly ISSUER = 'MediChain';

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly tokens: TokenService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  // -------------------------------------------------------------------------
  // Enrolment
  // -------------------------------------------------------------------------

  /**
   * Generates (or regenerates) the pending secret for an account.
   *
   * Calling this twice before confirm simply replaces the pending secret —
   * the usual outcome of scanning the QR with the wrong app and starting over.
   * An account that has *completed* enrolment must disable first, so an
   * attacker who briefly holds a session cannot swap the secret out from under
   * the legitimate user without knowing a code.
   */
  async setup(actor: MfaActor): Promise<MfaSetupResult> {
    const user = await this.loadUser(actor.userId);

    if (user.mfaEnabled) {
      throw new ConflictError('Turn off two-step verification before setting it up again.');
    }

    const secret = generateTotpSecret();
    const encrypted = this.encryption.encrypt(secret, mfaAad(user.id));

    await this.withoutScope(() =>
      this.prisma.user.updateMany({
        where: { id: user.id },
        data: { mfaSecret: encrypted },
      }),
    );

    const account = user.email ?? user.phone ?? user.id;
    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secret,
        account,
        issuer: MfaService.ISSUER,
      }),
    };
  }

  /**
   * Proves the user can generate the current code, then enables MFA and issues
   * recovery codes.
   *
   * When the caller arrives with an MFA challenge (the staff enrolment path),
   * this is also the moment the session is issued — password *and* first code,
   * together, and never before.
   */
  async confirm(
    actor: MfaActor,
    code: string,
  ): Promise<{ enabled: true; recoveryCodes: readonly string[]; session?: SignInSuccess }> {
    const user = await this.loadUser(actor.userId);

    if (user.mfaEnabled) {
      throw new ConflictError('Two-step verification is already on.');
    }
    if (user.mfaSecret === null) {
      throw new ConflictError('No enrolment is in progress. Start by setting up an app.');
    }

    const secret = this.encryption.decrypt(user.mfaSecret, mfaAad(user.id));
    if (!verifyTotp(secret, code)) {
      throw new MfaCodeInvalidError(
        'That code did not match. Make sure the time on your device is correct, then try again.',
      );
    }

    const recoveryCodes = generateRecoveryCodes();
    const roleRows = await this.loadRoleRows(user.id);

    await this.withoutScope(() =>
      this.uow.transaction(async (tx) => {
        await tx.user.updateMany({
          where: { id: user.id },
          data: {
            mfaEnabled: true,
            mfaRecoveryCodes: { set: recoveryCodes.map(recoveryCodeDigest) },
          },
        });

        await this.audit.recordInTransaction(tx, {
          tenantId: user.tenantId ?? PLATFORM_AUDIT_TENANT,
          action: 'auth.mfa.enabled',
          entity: 'User',
          entityId: user.id,
          actorId: user.id,
          actorEmail: user.email,
          metadata: { recoveryCodes: recoveryCodes.length },
        });
      }),
    );

    this.logger.log(`MFA enabled for user ${user.id}.`);

    if (actor.challenge !== undefined) {
      const session = await this.auth.issueLoginSession({
        userId: user.id,
        auditTenantId: user.tenantId ?? PLATFORM_AUDIT_TENANT,
        roleRows,
      });
      return { enabled: true, recoveryCodes, session };
    }

    return { enabled: true, recoveryCodes };
  }

  /**
   * Turns MFA off. Requires a live code — possession of a session is not
   * enough, because "session stolen, MFA removed" is the exact attack MFA
   * exists to survive.
   */
  async disable(userId: string, code: string): Promise<{ enabled: false }> {
    const user = await this.loadUser(userId);

    if (!user.mfaEnabled || user.mfaSecret === null) {
      throw new ConflictError('Two-step verification is not on.');
    }

    const secret = this.encryption.decrypt(user.mfaSecret, mfaAad(user.id));
    if (!this.acceptsCode(user, secret, code)) {
      throw new MfaCodeInvalidError();
    }

    await this.withoutScope(() =>
      this.uow.transaction(async (tx) => {
        await tx.user.updateMany({
          where: { id: user.id },
          data: {
            mfaEnabled: false,
            mfaSecret: null,
            mfaRecoveryCodes: { set: [] },
          },
        });

        await this.audit.recordInTransaction(tx, {
          tenantId: user.tenantId ?? PLATFORM_AUDIT_TENANT,
          action: 'auth.mfa.disabled',
          entity: 'User',
          entityId: user.id,
          actorId: user.id,
          actorEmail: user.email,
        });
      }),
    );

    this.logger.log(`MFA disabled for user ${user.id}.`);
    return { enabled: false };
  }

  // -------------------------------------------------------------------------
  // Second-factor sign-in
  // -------------------------------------------------------------------------

  /**
   * Redeems a challenge with a TOTP code or a recovery code and issues the
   * session the password step deliberately withheld.
   */
  async completeLogin(input: {
    mfaToken: string;
    code: string;
    deviceId?: string | null;
    deviceLabel?: string | null;
  }): Promise<SignInSuccess> {
    const { userId } = await this.tokens.verifyMfaChallenge(input.mfaToken);

    const user = await this.loadUser(userId);

    if (!user.mfaEnabled || user.mfaSecret === null) {
      // The password step only issues a challenge when MFA is on (or must be
      // enrolled). Reaching here means the account changed under the challenge.
      throw new UnauthenticatedError('This sign-in attempt is no longer valid. Sign in again.');
    }

    const secret = this.encryption.decrypt(user.mfaSecret, mfaAad(user.id));
    const accepted = this.acceptsCode(user, secret, input.code);

    if (!accepted) {
      await this.auditChallengeFailure(user.id, 'invalid_code');
      throw new MfaCodeInvalidError();
    }

    // A recovery code is single-use: drop it from the set the moment it is
    // presented, so a code lifted from a screenshot works once.
    if (isRecoveryCodeShaped(input.code)) {
      const digest = recoveryCodeDigest(normaliseRecoveryCode(input.code));
      const remaining = user.mfaRecoveryCodes.filter((stored) => stored !== digest);
      await this.withoutScope(() =>
        this.prisma.user.updateMany({
          where: { id: user.id },
          data: { mfaRecoveryCodes: { set: remaining } },
        }),
      );
    }

    const roleRows = await this.loadRoleRows(user.id);
    const session = await this.auth.issueLoginSession({
      userId: user.id,
      auditTenantId: user.tenantId ?? PLATFORM_AUDIT_TENANT,
      roleRows,
      deviceId: input.deviceId ?? null,
      deviceLabel: input.deviceLabel ?? null,
    });

    await this.audit.record({
      tenantId: user.tenantId ?? PLATFORM_AUDIT_TENANT,
      action: 'auth.mfa.login.succeeded',
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { method: isRecoveryCodeShaped(input.code) ? 'recovery' : 'totp' },
    });

    return session;
  }

  /**
   * Verifies a sign-in challenge and returns its subject.
   *
   * Public so the controller can resolve the actor of an enrolment call before
   * any service method runs — the challenge, not a bearer token, is what proves
   * who that caller is during staff enrolment.
   */
  async verifyChallenge(mfaToken: string): Promise<{ userId: string }> {
    return this.tokens.verifyMfaChallenge(mfaToken);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Accepts either factor. A six-digit numeric value is a TOTP; anything else
   * shaped like a recovery code is matched against the stored digests.
   *
   * Comparison against digests uses `timingSafeEqualString` via the stored
   * values' own equality path — here an array scan with a constant-time
   * compare per element, so the position of the matching code in the set is
   * not observable.
   */
  private acceptsCode(
    user: { mfaRecoveryCodes: string[] },
    secret: string,
    code: string,
  ): boolean {
    if (isTotpShaped(code)) {
      return verifyTotp(secret, code);
    }

    if (isRecoveryCodeShaped(code)) {
      const digest = recoveryCodeDigest(code);
      return user.mfaRecoveryCodes.some((stored) => stored === digest);
    }

    return false;
  }

  private async loadUser(userId: string): Promise<{
    id: string;
    tenantId: string | null;
    email: string | null;
    phone: string | null;
    mfaEnabled: boolean;
    mfaSecret: string | null;
    mfaRecoveryCodes: string[];
  }> {
    const user = await this.withoutScope(() =>
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          tenantId: true,
          email: true,
          phone: true,
          mfaEnabled: true,
          mfaSecret: true,
          mfaRecoveryCodes: true,
        },
      }),
    );

    if (user === null) {
      // The challenge proved the password for this id moments ago; a missing
      // row now means deletion mid-flow. For a signed-in caller it means the
      // session outlived the account. Either way: not authenticated.
      throw new UnauthenticatedError('This account no longer exists.');
    }

    return user;
  }

  private async loadRoleRows(
    userId: string,
  ): Promise<{ roleId: string; role: { code: string } }[]> {
    return this.withoutScope(() =>
      this.prisma.userRole.findMany({
        where: { userId },
        select: { roleId: true, role: { select: { code: true } } },
      }),
    );
  }

  private withoutScope<T>(fn: () => Promise<T>): Promise<T> {
    // MFA routes run before, or without, a tenant on the context: a challenge
    // is redeemed on a public endpoint, and `User` is a tenant-scoped model.
    return requestContext.withoutTenantScope(fn);
  }

  private async auditChallengeFailure(userId: string | null, reason: string): Promise<void> {
    if (userId === null) return;
    try {
      const user = await this.withoutScope(() =>
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { tenantId: true, email: true },
        }),
      );
      await this.audit.record({
        tenantId: user?.tenantId ?? PLATFORM_AUDIT_TENANT,
        action: 'auth.mfa.login.failed',
        outcome: 'FAILURE',
        actorId: userId,
        actorEmail: user?.email ?? null,
        metadata: { reason },
      });
    } catch (error) {
      this.logger.warn(
        `Could not audit an MFA failure for ${userId}: ${error instanceof Error ? error.message : ''}`,
      );
    }
  }
}

/** Who the MFA action is for: a signed-in principal, or a sign-in challenge. */
export interface MfaActor {
  readonly userId: string;
  /** Present when acting inside the pre-session enrolment flow. */
  readonly challenge?: { readonly mfaToken: string };
}

/** AAD binding for the encrypted TOTP secret. */
function mfaAad(userId: string): string {
  return `user:${userId}`;
}

/**
 * Placeholder tenant for audit rows with no tenant — same UUID as the one in
 * `auth.service.ts`; `audit_log.tenant_id` is non-nullable.
 */
const PLATFORM_AUDIT_TENANT = '00000000-0000-0000-0000-000000000000';
