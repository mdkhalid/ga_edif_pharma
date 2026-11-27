import type { OffsetPaginated } from './common';
import type { PaymentStatus } from './enums';

/**
 * Payment shapes as they cross the wire (P6 / A11).
 *
 * The service holds `Date`s and decimal money; JSON carries ISO strings and
 * paisa-formatted decimal strings. Declaring the shape here keeps the backend,
 * the typed client and the admin portal compiling against one definition.
 */
export type { PaymentStatus } from './enums';
export type PaymentProvider = 'mock' | 'razorpay' | 'stripe' | 'payu';

export interface PaymentSummary {
  readonly id: string;
  readonly organisationId: string;
  readonly orderId: string;
  readonly status: PaymentStatus;
  /** Paisa-formatted decimal string, e.g. `236.00`. */
  readonly amount: string;
  readonly currency: string;
  readonly provider: PaymentProvider;
  readonly gatewayReference: string | null;
  readonly idempotencyKey: string;
  /** ISO 8601. */
  readonly createdAt: string;
  /** ISO 8601. */
  readonly updatedAt: string;
}

export type PaymentPage = OffsetPaginated<PaymentSummary>;

export interface PaymentWebhookResult {
  readonly received: true;
  readonly duplicate: boolean;
}
