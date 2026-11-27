import type {
  PaymentProvider,
} from '../domain/payment.types';

/** DI token for the configured outbound gateway adapter. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface CreateGatewayIntentInput {
  readonly paymentId: string;
  readonly orderId: string;
  readonly amount: string;
  readonly currency: string;
}

/**
 * Outbound port. Nothing in the application layer knows a provider's payload
 * shape: the adapter translates it into a gateway reference and the webhook
 * translator turns callbacks back into the normalised event the domain uses.
 */
export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createIntent(input: CreateGatewayIntentInput): Promise<{ gatewayReference: string }>;
}
