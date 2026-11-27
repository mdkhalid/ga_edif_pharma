import type { PaymentEventType, PaymentStatus } from './payment-ledger';

/** Gateways the platform can route a payment through. */
export type PaymentProvider = 'mock' | 'razorpay' | 'stripe' | 'payu';

/** The four things a gateway can tell us about a payment after the fact. */
export type WebhookEventType = 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';

/**
 * The persisted payment aggregate. Money is a decimal string at the boundary:
 * the ledger holds `Money` in memory, but a column read back through Prisma
 * must leave a service via `paisa()` so it keeps a stable scale.
 */
export interface Payment {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly orderId: string;
  readonly status: PaymentStatus;
  /** Paisa-formatted, e.g. `236.00`. */
  readonly amount: string;
  readonly currency: string;
  readonly provider: PaymentProvider;
  readonly gatewayReference: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One append-only row of the persisted payment ledger. */
export interface PaymentEventRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly paymentId: string;
  readonly type: PaymentEventType;
  readonly status: PaymentStatus;
  readonly amount: string;
  readonly gatewayReference: string | null;
  /** `provider:eventId` — unique, so a replayed webhook cannot credit twice. */
  readonly gatewayEventId: string | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: Date;
}

/** Normalised webhook shape. The raw bytes are verified before this is trusted. */
export interface PaymentWebhookEvent {
  readonly eventId: string;
  readonly paymentId: string;
  readonly type: WebhookEventType;
  readonly gatewayReference?: string;
  readonly amount?: string;
  readonly currency?: string;
}

/**
 * Maps a gateway event to the ledger event that produces its status.
 *
 * `AUTHORIZED` and `WEBHOOK_RECEIVED` both mean "funds authorised", but they
 * are different facts: the first is a provider statement, the second is a
 * generic acknowledgement. Keeping them distinct in the ledger preserves the
 * explanation of why a payment moved.
 */
export function ledgerEventForWebhook(type: WebhookEventType): PaymentEventType {
  switch (type) {
    case 'AUTHORIZED':
      return 'GATEWAY_AUTHORIZED';
    case 'CAPTURED':
      return 'GATEWAY_CAPTURED';
    case 'FAILED':
      return 'GATEWAY_FAILED';
    case 'REFUNDED':
      return 'REFUND_COMPLETED';
  }
}
