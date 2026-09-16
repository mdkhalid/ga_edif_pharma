import type {
  ProductDetail,
  ProductMutationResult,
  ProductPage,
  ScheduleClass,
} from '@medichain/shared-types';

import { unwrap, type MediChainClient } from '../client';
import type { components } from '../generated/schema';

/**
 * Catalogue endpoints.
 *
 * Request bodies are taken from the generated schema — they *are* described by
 * the contract — while response types come from `@medichain/shared-types`,
 * because the `{ data: … }` success envelope is authored by each controller and
 * is therefore invisible to the generator. See the note in `client.ts`.
 */

export type CreateProductRequest = components['schemas']['CreateProductDto'];
export type UpdateProductRequest = components['schemas']['UpdateProductDto'];

/** Filters accepted by the browse endpoint. */
export interface ListProductsOptions {
  readonly page?: number;
  readonly pageSize?: number;
  /** Case-insensitive substring match on the product name. */
  readonly search?: string;
  readonly schedule?: ScheduleClass;
  /** Sort expression over `name`, `price` or `createdAt`; `-price` sorts descending. */
  readonly sort?: string;
}

export interface CatalogApi {
  /** Browse the catalogue. Reads a page of `ProductSummary`, not full products. */
  list(options?: ListProductsOptions): Promise<ProductPage>;
  getById(id: string): Promise<ProductDetail>;
  /** Requires an `Idempotency-Key`, so a retry cannot create a second product. */
  create(body: CreateProductRequest, idempotencyKey: string): Promise<ProductMutationResult>;
  update(id: string, body: UpdateProductRequest): Promise<ProductMutationResult>;
}

export function createCatalogApi(client: MediChainClient): CatalogApi {
  return {
    async list(options = {}) {
      return unwrap<ProductPage>(
        await client.GET('/catalog/products', { params: { query: options } }),
      );
    },

    async getById(id) {
      return unwrap<ProductDetail>(
        await client.GET('/catalog/products/{id}', { params: { path: { id } } }),
      );
    },

    async create(body, idempotencyKey) {
      return unwrap<ProductMutationResult>(
        await client.POST('/catalog/products', {
          body,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
    },

    async update(id, body) {
      return unwrap<ProductMutationResult>(
        await client.PATCH('/catalog/products/{id}', { body, params: { path: { id } } }),
      );
    },
  };
}
