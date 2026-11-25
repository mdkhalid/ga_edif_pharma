import type { StockPage, StockSummary } from '@medichain/shared-types';

import { unwrap, unwrapPage, type MediChainClient } from '../client';

/**
 * Read-only warehouse-stock API for the admin viewer.
 *
 * Quantities are decimal strings all the way to the screen: converting them to
 * JS numbers here would quietly turn a stock count into a float.
 */
export interface ListStockOptions {
  readonly productId?: string;
  readonly warehouseId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface StockApi {
  list(options?: ListStockOptions): Promise<StockPage>;
  getById(id: string): Promise<StockSummary>;
}

export function createStockApi(client: MediChainClient): StockApi {
  return {
    async list(options = {}) {
      return unwrapPage<StockPage>(
        await client.GET('/inventory/stock', { params: { query: options } }),
      );
    },

    async getById(id) {
      return unwrap<StockSummary>(
        await client.GET('/inventory/stock/{id}', { params: { path: { id } } }),
      );
    },
  };
}
