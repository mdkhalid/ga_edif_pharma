import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ActorType,
  type AuditOutcome,
  type JsonObject,
  type JsonValue,
} from '@medichain/shared-types';

import { requestContext } from '../../../common/context/request-context';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import type { TransactionClient } from '../../../database/unit-of-work';

/**
 * Writes the append-only audit trail.
 *
 * ## Append-only means append-only
 *
 * There is no update method and no delete method on this service, and the
 * database enforces the same rule: `audit_log` carries `BEFORE UPDATE OR DELETE`
 * and `BEFORE TRUNCATE` triggers that raise, so a future
 * `prisma.auditLog.deleteMany()` fails at the database rather than silently
 * succeeding.
 *
 * The enforcement is a trigger rather than a `REVOKE`, because a `REVOKE` cannot
 * bind the table's owner — PostgreSQL gives an owner an implicit, non-revocable
 * grant, so the application's own role would keep the ability to rewrite the
 * trail while the migration appeared to have removed it. A retention purge or a
 * test fixture clears the table by setting `medichain.allow_audit_mutation` for
 * one transaction; see the migration for the escape hatch.
 *
 * ## Two entry points, and when to use each
 *
 * `recordInTransaction` is the correct one for anything that changes business
 * state, and it must be called with the same `tx` client as the change.
 *
 * The reason is not stylistic. A row written on a separate connection:
 *
 *   - survives a rolled-back mutation, recording a change that never happened, or
 *   - is lost when the mutation commits, if the write fails after the commit.
 *
 * Both make the log disagree with reality, and a log that disagrees with reality
 * is worse than no log — it is actively misleading during an investigation.
 *
 * `record` (outside a transaction) exists for events that are not tied to a
 * state change: a failed sign-in, a permission denial, a rate-limit trip. There
 * is nothing to be atomic with, and refusing to record them because there is no
 * transaction would lose exactly the security events worth having.
 *
 * ## What is never recorded
 *
 * Passwords, tokens, OTPs, full request bodies, and prescription payloads. The
 * log is widely readable by support staff and immutable, so it must not become a
 * second copy of sensitive data that cannot be redacted later. `changes` holds
 * field-level before/after pairs for the fields that matter, chosen by the
 * caller.
 */

export interface AuditEntry {
  /**
   * Tenant the action belongs to.
   *
   * Required and explicit rather than read from context, because the most
   * security-relevant audit rows — failed sign-ins, blocked cross-tenant access
   * — happen when there is no authenticated tenant on the context.
   */
  readonly tenantId: string;
  /** Stable machine-readable action, e.g. `auth.login.succeeded`. */
  readonly action: string;
  readonly entity?: string;
  readonly entityId?: string;
  readonly outcome?: AuditOutcome;

  /** Defaults to the authenticated principal. Override for pre-auth events. */
  readonly actorId?: string | null;
  readonly actorEmail?: string | null;
  readonly actorRole?: string | null;
  readonly actorType?: ActorType;

  /** Field-level diff: `{ status: { from: 'PLACED', to: 'CONFIRMED' } }`. */
  readonly changes?: Record<string, { from: JsonValue; to: JsonValue }>;
  readonly metadata?: JsonObject;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  /**
   * Records an entry inside the caller's transaction.
   *
   * Always prefer this. The audit row commits if and only if the change does.
   */
  async recordInTransaction(tx: TransactionClient, entry: AuditEntry): Promise<void> {
    const context = requestContext.get();

    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        action: entry.action,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        outcome: entry.outcome ?? 'SUCCESS',

        actorType: entry.actorType ?? context?.principal?.actorType ?? ActorType.USER,
        actorId: entry.actorId ?? context?.principal?.userId ?? null,
        actorEmail: entry.actorEmail ?? null,
        actorRole: entry.actorRole ?? context?.principal?.roles[0] ?? null,

        // The correlation id is what ties this row to the log lines and traces of
        // the request that produced it. Without it, an investigation has an
        // audit row and a pile of logs and no way to join them.
        correlationId: context?.correlationId ?? null,
        requestId: context?.requestId ?? null,

        ipAddress: context?.ip ?? null,
        userAgent: context?.userAgent?.slice(0, 500) ?? null,

        changes: entry.changes ?? undefined,
        metadata: entry.metadata ?? undefined,
      },
    });
  }

  /**
   * Records an entry outside any transaction.
   *
   * For events with no state change to be atomic with. A failure to write is
   * logged and swallowed — an audit write must never turn a successful sign-in
   * rejection into a 500 — but it is logged at error level, because a silently
   * broken audit trail is a compliance problem that surfaces at the worst
   * possible moment.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      const context = requestContext.get();

      await this.prisma.auditLog.create({
        data: {
          tenantId: entry.tenantId,
          action: entry.action,
          entity: entry.entity ?? null,
          entityId: entry.entityId ?? null,
          outcome: entry.outcome ?? 'SUCCESS',

          actorType: entry.actorType ?? context?.principal?.actorType ?? ActorType.USER,
          actorId: entry.actorId ?? context?.principal?.userId ?? null,
          actorEmail: entry.actorEmail ?? null,
          actorRole: entry.actorRole ?? context?.principal?.roles[0] ?? null,

          correlationId: context?.correlationId ?? null,
          requestId: context?.requestId ?? null,

          ipAddress: context?.ip ?? null,
          userAgent: context?.userAgent?.slice(0, 500) ?? null,

          changes: entry.changes ?? undefined,
          metadata: entry.metadata ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry "${entry.action}" for tenant ${entry.tenantId}: ` +
          `${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /**
   * Records a failed sign-in.
   *
   * A convenience because this is the single most common security event, and it
   * has a shape that is easy to get subtly wrong: the account may not exist, so
   * there is no actor id, and the email must be recorded because the whole point
   * is to see which addresses are being targeted.
   */
  async recordFailedLogin(input: {
    tenantId: string;
    email: string;
    userId: string | null;
    reason: string;
  }): Promise<void> {
    await this.record({
      tenantId: input.tenantId,
      action: 'auth.login.failed',
      outcome: 'FAILURE',
      actorId: input.userId,
      actorEmail: input.email,
      metadata: { reason: input.reason },
    });
  }

  /**
   * Records refresh-token reuse.
   *
   * This is the one session event that is always worth a row, and the reason is
   * asymmetry rather than importance:
   *
   *   - A *successful* rotation is routine and happens every access-token
   *     lifetime for every active user. At a million users that is millions of
   *     rows a day, and none of them would ever be read. It is deliberately not
   *     audited.
   *   - A *reuse* is rare, and it is the only signal the system produces that a
   *     refresh token has probably been stolen. The response — revoking the
   *     entire token family — is automatic, so without this row the strongest
   *     evidence of a compromise is that a user was unexpectedly signed out.
   *
   * `detection` distinguishes the two ways reuse is found: presenting an
   * already-used token (`pre_check`), and losing the compare-and-set race
   * (`lost_race`). The second is usually a legitimate client retrying after a
   * dropped response, which is why it is worth recording separately rather than
   * as the same event.
   */
  async recordRefreshReuse(input: {
    tenantId: string;
    userId: string;
    sessionId: string;
    detection: 'pre_check' | 'lost_race';
  }): Promise<void> {
    await this.record({
      tenantId: input.tenantId,
      action: 'auth.refresh.reuse_detected',
      outcome: 'FAILURE',
      entity: 'Session',
      entityId: input.sessionId,
      actorId: input.userId,
      metadata: {
        sessionId: input.sessionId,
        detection: input.detection,
        familyRevoked: true,
      },
    });
  }
}
