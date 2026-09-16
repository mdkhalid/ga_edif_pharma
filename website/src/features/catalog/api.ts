'use client';

import { createCatalogApi } from '@medichain/api-client';
import type { ProductPage, ScheduleClass } from '@medichain/shared-types';

import { callAuthed } from '@/features/auth/api';

/**
 * Catalogue reads.
 *
 * There is no transport here on purpose. `callAuthed` already builds a client bound
 * to the in-memory access token and refreshes once on a 401, and it owns the
 * single-flight guard that keeps concurrent refreshes from looking like token
 * theft. A feature that rolled its own would be a second place for that guard to be
 * forgotten.
 */

export const CATALOGUE_PAGE_SIZE = 20;

export interface ProductQuery {
  readonly page: number;
  readonly pageSize: number;
  /** Case-insensitive substring of the product name. */
  readonly search?: string;
  readonly schedule?: ScheduleClass;
}

export function listProducts(query: ProductQuery): Promise<ProductPage> {
  return callAuthed((client) => createCatalogApi(client).list(query));
}
