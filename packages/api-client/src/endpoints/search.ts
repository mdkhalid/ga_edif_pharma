import type { SaltSearchPage, ScheduleClass } from '@medichain/shared-types';

import { unwrap, type MediChainClient } from '../client';

/**
 * Salt-combination search.
 *
 * The query is a salt expression, not a product name: `Paracetamol + Cetirizine`
 * and `paracetamol,cetirizine` both mean "products containing both". Parsing and
 * matching belong to the salt engine on the server, so nothing here normalises
 * the string — a client that tidies it up would be guessing at a rule the engine
 * already owns.
 */
export interface SearchProductsOptions {
  readonly q: string;
  readonly schedule?: ScheduleClass;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface SearchApi {
  /** Products whose composition matches every salt named in `q`. */
  products(options: SearchProductsOptions): Promise<SaltSearchPage>;
}

export function createSearchApi(client: MediChainClient): SearchApi {
  return {
    async products(options) {
      return unwrap<SaltSearchPage>(
        await client.GET('/search/products', { params: { query: options } }),
      );
    },
  };
}
