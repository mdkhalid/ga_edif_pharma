import type {
  InvoiceDetail,
  InvoiceIssueResult,
  InvoicePage,
  InvoiceStatus,
} from '@medichain/shared-types';

import { unwrap, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/**
 * Tax-invoice endpoints.
 *
 * Issue takes no lines: the invoice is always computed from the order's priced
 * lines, so the order is the single source of truth and there is no second
 * place for a line to come from. Re-issuing an already-invoiced order returns
 * the existing invoice, never a second number.
 */

export type IssueInvoiceRequest = components['schemas']['IssueInvoiceDto'];
export type CancelInvoiceRequest = components['schemas']['CancelInvoiceDto'];

export interface ListInvoicesOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly status?: InvoiceStatus;
  readonly orderId?: string;
}

export interface InvoicesApi {
  /** Requires an `Idempotency-Key`; a retry replays the first invoice, never a second. */
  issue(body: IssueInvoiceRequest, idempotencyKey: string): Promise<InvoiceIssueResult>;
  /** The caller organisation's invoices, or every invoice in the tenant for staff. */
  list(options?: ListInvoicesOptions): Promise<InvoicePage>;
  getById(id: string): Promise<InvoiceDetail>;
  /** Cancels an issued invoice. Only ISSUED invoices can be cancelled. */
  cancel(id: string, reason?: string): Promise<{ id: string }>;
}

export function createInvoicesApi(client: MediChainClient): InvoicesApi {
  return {
    async issue(body, idempotencyKey) {
      return unwrap<InvoiceIssueResult>(
        await client.POST('/invoices/issue', {
          body,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
    },

    async list(options = {}) {
      return unwrap<InvoicePage>(await client.GET('/invoices', { params: { query: options } }));
    },

    async getById(id) {
      return unwrap<InvoiceDetail>(
        await client.GET('/invoices/{id}', { params: { path: { id } } }),
      );
    },

    async cancel(id, reason) {
      return unwrap<{ id: string }>(
        await client.POST('/invoices/{id}/cancel', {
          body: { reason },
          params: { path: { id } },
        }),
      );
    },
  };
}
