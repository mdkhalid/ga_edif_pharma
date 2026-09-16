import type {
  OrderDetail,
  OrderPage,
  OrderPlacementResult,
  OrderStatus,
  OrderTransitionResult,
} from '@medichain/shared-types';

import { unwrap, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/**
 * Order endpoints.
 *
 * Placement takes no line items: the order is always placed from the caller's
 * ACTIVE cart, so the cart's availability checks are the order's availability
 * checks and there is no second place for a line to come from.
 */

export type PlaceOrderRequest = components['schemas']['PlaceOrderDto'];

export interface ListOrdersOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly status?: OrderStatus;
}

export interface OrdersApi {
  /** Requires an `Idempotency-Key`; a retry replays the first order, never a second. */
  place(body: PlaceOrderRequest, idempotencyKey: string): Promise<OrderPlacementResult>;
  /** The caller organisation's orders, or every order in the tenant for staff. */
  list(options?: ListOrdersOptions): Promise<OrderPage>;
  getById(id: string): Promise<OrderDetail>;

  /*
   * The fulfilment transitions, one method per route.
   *
   * Deliberately not collapsed into a single `transition(id, action)`: the
   * actions are separate endpoints with separate capability requirements, and a
   * wrapper that switched on a string would be the only place that mapping lives
   * — invisible to the contract, and unenforced by the compiler.
   */

  confirm(id: string, reason?: string): Promise<OrderTransitionResult>;
  process(id: string, reason?: string): Promise<OrderTransitionResult>;
  dispatch(id: string, reason?: string): Promise<OrderTransitionResult>;
  deliver(id: string, reason?: string): Promise<OrderTransitionResult>;
  /** Cancels the order and releases every stock reservation it holds. */
  cancel(id: string, reason?: string): Promise<OrderTransitionResult>;
}

export function createOrdersApi(client: MediChainClient): OrdersApi {
  const transition = async (
    path:
      | '/orders/{id}/confirm'
      | '/orders/{id}/process'
      | '/orders/{id}/dispatch'
      | '/orders/{id}/deliver'
      | '/orders/{id}/cancel',
    id: string,
    reason?: string,
  ): Promise<OrderTransitionResult> =>
    unwrap<OrderTransitionResult>(
      await client.POST(path, { body: { reason }, params: { path: { id } } }),
    );

  return {
    async place(body, idempotencyKey) {
      return unwrap<OrderPlacementResult>(
        await client.POST('/orders', {
          body,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
    },

    async list(options = {}) {
      return unwrap<OrderPage>(await client.GET('/orders', { params: { query: options } }));
    },

    async getById(id) {
      return unwrap<OrderDetail>(
        await client.GET('/orders/{id}', { params: { path: { id } } }),
      );
    },

    confirm: (id, reason) => transition('/orders/{id}/confirm', id, reason),
    process: (id, reason) => transition('/orders/{id}/process', id, reason),
    dispatch: (id, reason) => transition('/orders/{id}/dispatch', id, reason),
    deliver: (id, reason) => transition('/orders/{id}/deliver', id, reason),
    cancel: (id, reason) => transition('/orders/{id}/cancel', id, reason),
  };
}
