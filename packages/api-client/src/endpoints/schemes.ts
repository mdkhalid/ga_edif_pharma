import type { OffsetPaginated, SchemeSummary } from '@medichain/shared-types';

import { unwrap, unwrapPage, unwrapVoid, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/**
 * Scheme-management endpoints, backed by the pricing module's admin API.
 *
 * The browser sees `SchemeSummary` (plain JSON) rather than the pricing engine's
 * `Scheme` domain object: `Money`, `Quantity`, and decimal columns do not cross
 * the wire. See `packages/shared-types/src/schemes.ts`.
 */
export type CreateSchemeRequest = components['schemas']['CreateSchemeDto'];
export type UpdateSchemeRequest = components['schemas']['UpdateSchemeDto'];

export interface ListSchemesOptions {
  readonly status?: 'ACTIVE' | 'INACTIVE';
  readonly kind?: 'PERCENTAGE' | 'FLAT' | 'FREE_GOODS' | 'COMBO';
  readonly page?: number;
  readonly pageSize?: number;
}

export interface SchemesApi {
  list(options?: ListSchemesOptions): Promise<OffsetPaginated<SchemeSummary>>;
  getById(id: string): Promise<SchemeSummary>;
  create(body: CreateSchemeRequest): Promise<{ id: string }>;
  /** Partial update; only fields present in the body are changed. */
  update(id: string, body: UpdateSchemeRequest): Promise<void>;
  /** Sets status to INACTIVE. The scheme and its history are retained. */
  archive(id: string): Promise<void>;
}

export function createSchemesApi(client: MediChainClient): SchemesApi {
  return {
    async list(options = {}) {
      return unwrapPage<OffsetPaginated<SchemeSummary>>(
        await client.GET('/schemes', { params: { query: options } }),
      );
    },

    async getById(id) {
      return unwrap<SchemeSummary>(
        await client.GET('/schemes/{id}', { params: { path: { id } } }),
      );
    },

    async create(body) {
      return unwrap<{ id: string }>(await client.POST('/schemes', { body }));
    },

    async update(id, body) {
      await unwrapVoid(
        await client.PATCH('/schemes/{id}', { body, params: { path: { id } } }),
      );
    },

    async archive(id) {
      await unwrapVoid(await client.DELETE('/schemes/{id}', { params: { path: { id } } }));
    },
  };
}
