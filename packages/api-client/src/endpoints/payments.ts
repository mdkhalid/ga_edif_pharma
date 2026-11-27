import type {
  PaymentPage,
  PaymentSummary,
  PaymentWebhookResult,
} from '@medichain/shared-types';

import { unwrap, unwrapPage, type MediChainClient } from '../client';
import { toApiError } from '../error';
import type { components } from '../generated/schema';

export type CreatePaymentRequest = components['schemas']['CreatePaymentIntentDto'];
export type RefundPaymentRequest = components['schemas']['RefundPaymentDto'];
export type PaymentWebhookRequest = components['schemas']['PaymentWebhookDto'];

export interface ListPaymentsOptions {
  readonly status?: string;
  readonly organisationId?: string;
  readonly orderId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Payment endpoints (P6 / A11).
 *
 * Responses are `{ data }`-wrapped by the controller and their shapes live in
 * `@medichain/shared-types`; request bodies come from the generated contract.
 * The idempotency key is a header on both the interceptor and the handler, so
 * the generated spec names it twice and both are sent with the same value.
 */
export interface PaymentsApi {
  createIntent(body: CreatePaymentRequest, idempotencyKey: string): Promise<PaymentSummary>;
  list(options?: ListPaymentsOptions): Promise<PaymentPage>;
  getById(id: string): Promise<PaymentSummary>;
  refund(id: string, body?: RefundPaymentRequest): Promise<{ id: string }>;
  /** Gateway callbacks are signed at the edge; exposed for mock-gateway tests. */
  submitWebhook(
    body: PaymentWebhookRequest,
    signature: string,
    provider?: string,
  ): Promise<PaymentWebhookResult>;
}

export function createPaymentsApi(client: MediChainClient): PaymentsApi {
  return {
    async createIntent(body, idempotencyKey) {
      return unwrap<PaymentSummary>(
        await client.POST('/payments/intents', {
          body,
          params: {
            header: {
              'idempotency-key': idempotencyKey,
              'Idempotency-Key': idempotencyKey,
            },
          },
        }),
      );
    },

    async list(options = {}) {
      return unwrapPage<PaymentPage>(
        await client.GET('/payments', { params: { query: options } }),
      );
    },

    async getById(id) {
      return unwrap<PaymentSummary>(
        await client.GET('/payments/{id}', { params: { path: { id } } }),
      );
    },

    async refund(id, body = {}) {
      return unwrap<{ id: string }>(
        await client.POST('/payments/{id}/refund', {
          body,
          params: { path: { id } },
        }),
      );
    },

    async submitWebhook(body, signature, provider = 'mock') {
      // @RawResponse(): the gateway acknowledgement is deliberately not wrapped
      // in `{ data }`, so `unwrap()` would hand back undefined.
      const result = await client.POST('/payments/webhooks', {
        body,
        params: {
          header: {
            'x-payment-provider': provider,
            'x-payment-signature': signature,
          },
        },
      });
      if (!result.response.ok) throw await toApiError(result.response, result.error);
      return result.data as unknown as PaymentWebhookResult;
    },
  };
}
