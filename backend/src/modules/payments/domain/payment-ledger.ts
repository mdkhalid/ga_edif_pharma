import { Money } from '../../pricing/domain/money.vo';

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED';

export type PaymentEventType =
  | 'INTENT_CREATED'
  | 'GATEWAY_REQUESTED'
  | 'GATEWAY_AUTHORIZED'
  | 'GATEWAY_CAPTURED'
  | 'GATEWAY_FAILED'
  | 'WEBHOOK_RECEIVED'
  | 'WEBHOOK_REJECTED'
  | 'REFUND_INITIATED'
  | 'REFUND_COMPLETED'
  | 'CANCELLED';

export interface PaymentLedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly paymentId: string;
  readonly type: PaymentEventType;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly gatewayReference: string | null;
  readonly idempotencyKey: string | null;
  readonly metadata: Record<string, string>;
  readonly createdAt: Date;
}

export class PaymentStateTransitionError extends Error {
  constructor(
    public readonly paymentId: string,
    public readonly from: PaymentStatus,
    public readonly to: PaymentStatus,
  ) {
    super(`Invalid payment state transition: ${from} → ${to} for payment ${paymentId}`);
    this.name = 'PaymentStateTransitionError';
  }
}

export class DuplicateIdempotencyKeyError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Duplicate idempotency key: ${idempotencyKey}`);
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

export interface AppendPaymentEntryInput {
  readonly id: string;
  readonly tenantId: string;
  readonly paymentId: string;
  readonly type: PaymentEventType;
  readonly amount: Money;
  readonly gatewayReference?: string;
  readonly idempotencyKey?: string;
  readonly metadata?: Record<string, string>;
  readonly createdAt: Date;
}

const VALID_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['AUTHORIZED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['CAPTURED', 'REFUNDED', 'FAILED'],
  CAPTURED: ['REFUNDED', 'CAPTURED'],
  FAILED: ['PENDING'],
  REFUNDED: [],
  CANCELLED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function statusForEvent(eventType: PaymentEventType): PaymentStatus {
  switch (eventType) {
    case 'INTENT_CREATED':
      return 'PENDING';
    case 'GATEWAY_REQUESTED':
      return 'PROCESSING';
    case 'GATEWAY_AUTHORIZED':
      return 'AUTHORIZED';
    case 'GATEWAY_CAPTURED':
      return 'CAPTURED';
    case 'GATEWAY_FAILED':
      return 'FAILED';
    case 'WEBHOOK_RECEIVED':
      return 'AUTHORIZED';
    case 'WEBHOOK_REJECTED':
      return 'FAILED';
    case 'REFUND_INITIATED':
      return 'CAPTURED';
    case 'REFUND_COMPLETED':
      return 'REFUNDED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

export class PaymentLedger {
  private readonly _entries: PaymentLedgerEntry[];
  private readonly _idempotencyKeys: Set<string>;

  constructor(entries: readonly PaymentLedgerEntry[] = []) {
    this._entries = [...entries];
    this._idempotencyKeys = new Set(
      entries.map((e) => e.idempotencyKey).filter((k): k is string => k !== null),
    );
  }

  get entries(): readonly PaymentLedgerEntry[] {
    return Object.freeze([...this._entries]);
  }

  currentStatus(paymentId: string): PaymentStatus | null {
    const entries = this._entries.filter((e) => e.paymentId === paymentId);
    if (entries.length === 0) return null;
    return entries[entries.length - 1]!.status;
  }

  append(input: AppendPaymentEntryInput): PaymentLedger {
    const newStatus = statusForEvent(input.type);
    const currentStatus = this.currentStatus(input.paymentId);

    if (currentStatus !== null && !canTransition(currentStatus, newStatus)) {
      throw new PaymentStateTransitionError(input.paymentId, currentStatus, newStatus);
    }

    if (input.idempotencyKey) {
      if (this._idempotencyKeys.has(input.idempotencyKey)) {
        throw new DuplicateIdempotencyKeyError(input.idempotencyKey);
      }
    }

    const entry: PaymentLedgerEntry = {
      id: input.id,
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      type: input.type,
      status: newStatus,
      amount: input.amount,
      gatewayReference: input.gatewayReference ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: Object.freeze({ ...input.metadata }),
      createdAt: input.createdAt,
    };

    const newKeys = new Set(this._idempotencyKeys);
    if (entry.idempotencyKey) {
      newKeys.add(entry.idempotencyKey);
    }

    const ledger = new PaymentLedger([...this._entries, entry]);
    (ledger as any)._idempotencyKeys = newKeys;
    return ledger;
  }

  verifyIdempotencyKeys(): boolean {
    const seen = new Set<string>();
    for (const entry of this._entries) {
      if (entry.idempotencyKey !== null) {
        if (seen.has(entry.idempotencyKey)) return false;
        seen.add(entry.idempotencyKey);
      }
    }
    return true;
  }
}
