import type { CreditPage, CreditSummary, OrganisationStatus } from '@medichain/shared-types';

import { unwrap, unwrapPage, type MediChainClient } from '../client';

/**
 * Read-only credit API for the admin viewer.
 *
 * Today the authoritative exposure is `Organisation.currentExposure`, maintained
 * in the order transaction; a persisted credit ledger does not exist yet. The
 * screen therefore reports balances, not a reconstructed history.
 */
export interface ListCreditOptions {
  /** Substring of the legal or trade name. */
  readonly search?: string;
  readonly status?: OrganisationStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface CreditApi {
  list(options?: ListCreditOptions): Promise<CreditPage>;
  getById(organisationId: string): Promise<CreditSummary>;
}

export function createCreditApi(client: MediChainClient): CreditApi {
  return {
    async list(options = {}) {
      return unwrapPage<CreditPage>(
        await client.GET('/credit/summary', { params: { query: options } }),
      );
    },

    async getById(organisationId) {
      return unwrap<CreditSummary>(
        await client.GET('/credit/summary/{organisationId}', {
          params: { path: { organisationId } },
        }),
      );
    },
  };
}
