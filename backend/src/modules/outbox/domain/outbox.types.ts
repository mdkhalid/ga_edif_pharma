/**
 * Outbox domain types (P10).
 *
 * The outbox turns a best-effort notification into a durable, at-least-once
 * delivery: the event row is inserted *inside* the business transaction, so it
 * exists iff the change committed; a relay publishes it afterwards with retry
 * and dead-lettering. Every handler must therefore be idempotent, keyed by the
 * event's stable `id`.
 */

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'DEAD';

export interface OutboxEvent {
  readonly id: string;
  readonly tenantId: string | null;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly deduplicationKey: string | null;
}

export interface EnqueueInput {
  tenantId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  deduplicationKey?: string | null;
  availableAt?: Date;
}

/** Retry policy: exponential backoff capped at 5 minutes. */
export function nextAvailableAt(attempts: number): Date {
  const baseMs = 1000;
  const delay = Math.min(baseMs * Math.pow(2, attempts), 5 * 60 * 1000);
  return new Date(Date.now() + delay);
}

export function isDead(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}
