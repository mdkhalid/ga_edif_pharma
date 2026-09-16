import type { AddCartItemResult, CartView, UpdateCartItemResult } from '@medichain/shared-types';

import { unwrap, unwrapVoid, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/**
 * Cart endpoints.
 *
 * The cart belongs to the caller's organisation, so no path carries a cart id —
 * there is nothing to guess and nothing to authorise per-request.
 */

export type AddCartItemRequest = components['schemas']['AddItemDto'];

export interface CartApi {
  /** Throws `NOT_FOUND` when the organisation has no ACTIVE cart yet. */
  get(): Promise<CartView>;
  /** Requires an `Idempotency-Key`, so a double-tap cannot double the quantity. */
  add(body: AddCartItemRequest, idempotencyKey: string): Promise<AddCartItemResult>;
  /** Setting a quantity of zero removes the line — the server treats it as a removal. */
  updateQuantity(productId: string, quantity: number): Promise<UpdateCartItemResult>;
  remove(productId: string): Promise<void>;
}

export function createCartApi(client: MediChainClient): CartApi {
  return {
    async get() {
      return unwrap<CartView>(await client.GET('/cart', {}));
    },

    async add(body, idempotencyKey) {
      return unwrap<AddCartItemResult>(
        await client.POST('/cart/items', {
          body,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
    },

    async updateQuantity(productId, quantity) {
      return unwrap<UpdateCartItemResult>(
        await client.PATCH('/cart/items/{productId}', {
          body: { quantity },
          params: { path: { productId } },
        }),
      );
    },

    async remove(productId) {
      return unwrapVoid(
        await client.DELETE('/cart/items/{productId}', { params: { path: { productId } } }),
      );
    },
  };
}
