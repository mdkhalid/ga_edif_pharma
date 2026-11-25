import type { PriceListDetail, PriceListPage, PriceListStatus } from '@medichain/shared-types';

import { unwrap, unwrapPage, type MediChainClient } from '../client';

/**
 * Read-only price-list API for the admin viewer.
 *
 * Pricing writes are deliberately not exposed: a list that is effective today
 * changes the price of every order that reads it, so editing stays a backend and
 * migration concern until there is a proper approval flow.
 */
export interface ListPriceListsOptions {
  readonly status?: PriceListStatus;
  /** Case-insensitive substring of the list name. */
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PriceListsApi {
  list(options?: ListPriceListsOptions): Promise<PriceListPage>;
  getById(id: string): Promise<PriceListDetail>;
}

export function createPriceListsApi(client: MediChainClient): PriceListsApi {
  return {
    async list(options = {}) {
      return unwrapPage<PriceListPage>(
        await client.GET('/price-lists', { params: { query: options } }),
      );
    },

    async getById(id) {
      return unwrap<PriceListDetail>(
        await client.GET('/price-lists/{id}', { params: { path: { id } } }),
      );
    },
  };
}
