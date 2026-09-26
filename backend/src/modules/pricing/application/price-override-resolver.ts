import { Money } from '../domain/money.vo';

/**
 * Plain, DB-agnostic input to the override resolver.
 *
 * The Prisma adapter maps its rows into this shape and then calls the pure
 * `resolvePriceOverrideMap` below, so the selection logic is unit-testable with
 * no database. Keeping it pure mirrors the rest of the pricing module: the
 * engine is pure, and so is the rule that decides which price applies.
 */
export interface ResolverPriceListLine {
  readonly productId: string;
  readonly minQty: number;
  /** Per-unit override price, as an exact decimal string. */
  readonly unitPrice: string;
}

export interface ResolverData {
  /**
   * Direct per-customer overrides, keyed by productId. These win unconditionally
   * over any assigned price list — a customer-negotiated price is never beaten by
   * a list price.
   */
  readonly directOverrides: ReadonlyMap<string, string>;
  /**
   * The customer's currently-effective price list, or `null` when the customer is
   * on no list or the assigned list is outside its effective window. Its lines
   * carry quantity tiers.
   */
  readonly priceList: { readonly lines: readonly ResolverPriceListLine[] } | null;
  /** The lines actually being priced. */
  readonly lines: readonly { readonly productId: string; readonly quantity: number }[];
}

/**
 * Resolve the effective per-product override price.
 *
 * Precedence per product:
 *   1. A direct customer override (negotiated price) — beats everything.
 *   2. Otherwise, the best quantity tier of the assigned price list: among lines
 *      for the product whose `minQty` the quantity meets, the one with the
 *      *highest* `minQty` wins (a bulk tier must beat a retail tier).
 *
 * Products with no applicable override are omitted, so the engine prices them at
 * the catalogue base price.
 */
export function resolvePriceOverrideMap(data: ResolverData): Record<string, Money> {
  const result: Record<string, Money> = {};

  for (const line of data.lines) {
    const direct = data.directOverrides.get(line.productId);
    if (direct !== undefined) {
      result[line.productId] = new Money(direct);
      continue;
    }

    if (data.priceList) {
      let best: ResolverPriceListLine | null = null;
      for (const candidate of data.priceList.lines) {
        if (candidate.productId !== line.productId) continue;
        if (line.quantity < candidate.minQty) continue;
        if (best === null || candidate.minQty > best.minQty) best = candidate;
      }
      if (best) result[line.productId] = new Money(best.unitPrice);
    }
  }

  return result;
}
