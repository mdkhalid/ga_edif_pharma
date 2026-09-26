import { Money } from '../domain/money.vo';

/**
 * Pricing persistence port.
 *
 * Declared in `application/` and implemented in `infra/` (Prisma). The port
 * states what pricing needs — "given a customer and some lines, what override
 * price applies to each product?" — and the adapter decides how to read it. Swapping
 * Prisma for a flat-file or in-memory store is then a binding change, not a rewrite
 * of the pricing logic, and a unit test can bind the token to a stub.
 *
 * The returned map is keyed by `productId` and is exactly the shape the pure
 * pricing engine's `PricingContext.priceOverrides` consumes, so the two layers
 * meet at a single, typed boundary. `undefined` for a product ⇒ the engine falls
 * back to the catalogue base unit price.
 */
export const PRICING_REPOSITORY = Symbol('PricingRepository');

/** A line to price: which product, and in what quantity (for tier selection). */
export interface PricingLineKey {
  readonly productId: string;
  readonly quantity: number;
}

export interface ResolveOverridesInput {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly lines: readonly PricingLineKey[];
  /** The instant at which pricing is evaluated (price-list validity is relative to it). */
  readonly asOf: Date;
}

/**
 * Resolve the effective per-unit override price for each requested product.
 *
 * Returns only the products that *have* an override; products absent from the map
 * are priced at the catalogue base price by the engine.
 */
export interface PricingRepository {
  resolveOverrides(input: ResolveOverridesInput): Promise<Record<string, Money>>;
}
