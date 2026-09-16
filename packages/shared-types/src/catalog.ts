import type { DecimalString, OffsetPaginated } from './common';
import type { ProductStatus, ScheduleClass } from './enums';

/**
 * Catalogue response shapes.
 *
 * These live here, and not only in the OpenAPI document, because the document
 * models *request* DTOs and nothing else: each controller authors the
 * `{ data: … }` success envelope itself, so the generator sees a response with
 * no schema and the typed client's `data` is `unknown`. The backend compiles
 * against these interfaces too, which is what stops a fourth copy of the shape
 * from appearing and drifting.
 */

/** A product as it appears in a browse list. */
export interface ProductSummary {
  readonly id: string;
  readonly name: string;
  /** Controlled-substance schedule. `H` and above gate ordering behind a prescription. */
  readonly schedule: ScheduleClass;
  readonly price: DecimalString;
  readonly status: ProductStatus;
}

/** A product with the fields browse does not need. */
export interface ProductDetail extends ProductSummary {
  /** e.g. `650mg`. Null when the pack has no meaningful strength. */
  readonly strength: string | null;
}

export type ProductPage = OffsetPaginated<ProductSummary>;

/** The result of a create or update: the identity of the row that changed. */
export interface ProductMutationResult {
  readonly id: string;
}
