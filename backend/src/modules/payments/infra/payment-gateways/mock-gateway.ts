import { Injectable } from '@nestjs/common';

import type {
  CreateGatewayIntentInput,
  PaymentGateway,
} from '../../application/payment-gateway.port';

/**
 * The default outbound gateway. It makes no network call and holds no
 * credentials: it names the payment it was given and lets the signed webhook
 * drive the state change, exactly as a real provider would. Swapping in
 * Razorpay later is one provider binding in `PaymentsModule`, not a change to
 * the service or the ledger.
 */
@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly provider = 'mock' as const;

  async createIntent(input: CreateGatewayIntentInput): Promise<{ gatewayReference: string }> {
    return { gatewayReference: `mock_${input.paymentId}` };
  }
}
