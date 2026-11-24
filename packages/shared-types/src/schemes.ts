/**
 * Transport shapes for pricing schemes.
 *
 * These describe what the scheme-management API returns, not what the pricing
 * engine consumes: the engine uses the domain `Scheme` shape with `Money` and
 * `Quantity` value objects, while the wire shape is plain JSON. Keeping the two
 * separate is what lets the admin portal render a scheme without importing a
 * decimal or a stock-quantity class.
 */

export type SchemeKind = 'PERCENTAGE' | 'FLAT' | 'FREE_GOODS' | 'COMBO';
export type SchemeStatus = 'ACTIVE' | 'INACTIVE';

/** Dates are ISO strings on the wire; the database stores `timestamptz`. */
export interface SchemeSummary {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly kind: SchemeKind;
  readonly status: SchemeStatus;
  readonly productId: string | null;
  readonly categoryId: string | null;
  /** Discount percentage for PERCENTAGE schemes. */
  readonly percentOff: number | null;
  /** Minor-unit flat discount for FLAT schemes. */
  readonly flatOff: number | null;
  readonly minQty: number | null;
  readonly buyQty: number | null;
  readonly freeQty: number | null;
  readonly comboProductIds: readonly string[];
  readonly validFrom: string;
  readonly validTo: string;
  readonly stackable: boolean;
  readonly priority: number;
}
