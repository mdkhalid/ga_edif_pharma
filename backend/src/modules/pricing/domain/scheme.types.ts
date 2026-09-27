import { Money } from './money.vo';

/**
 * A discount scheme is **data**, not code. The engine interprets these shapes;
 * adding a scheme variant is a new field here plus a branch in the engine, never
 * a new code path scattered across controllers. Free-goods / combo kinds arrive
 * in P3; Phase 2 (P1) ships the two line-discount kinds that cover the common
 * trade schemes (percentage off, flat off).
 */
export type SchemeKind = 'PERCENTAGE' | 'FLAT' | 'FREE_GOODS' | 'COMBO';

export interface Scheme {
  id: string;
  kind: SchemeKind;

  /**
   * Scope. A scheme targets a product or a category; undefined target means
   * order-level (not yet handled in P1). A line is eligible when its product (or
   * category) matches.
   */
  productId?: string;
  categoryId?: string;

  /** PERCENTAGE: percent off the unit price, 0–100. */
  percentOff?: number;
  /** FLAT: fixed amount off the unit price. */
  flatOff?: Money;

  /**
   * FREE_GOODS: "buy `buyQty`, get `freeQty` free" of the targeted product.
   * `freeQty` units are granted for every `buyQty` paid units, capped so free
   * units never exceed the quantity bought. Defaults: `buyQty = 1`, `freeQty = 1`.
   * The free units are recorded on the line (`PricedLine.freeQuantity`) and cost
   * nothing, so the line's payable total drops by `freeQty × unitPrice`.
   *
   * v1 assumption (confirm with finance): free goods are granted for the *same*
   * targeted product. Cross-product free goods (e.g. buy shampoo, get a free
   * conditioner) need a separate free line and are out of scope for v1.
   */
  buyQty?: number;
  freeQty?: number;

  /**
   * COMBO: the scheme applies only when *every* product in `comboProductIds` is
   * present on the order. When eligible it discounts those lines like a
   * percentage/flat offer. Cross-line by nature, so it is evaluated in an
   * order-level pass after the per-line schemes.
   */
  comboProductIds?: string[];

  /** Minimum quantity on the targeted line for eligibility. */
  minQty?: number;

  /** Inclusive validity window. A scheme is only applicable when `asOf` is inside. */
  validFrom: Date;
  validTo: Date;

  /**
   * Stacking policy. Stackable schemes combine (in priority order). Non-stackable
   * schemes are mutually exclusive: when any applies, the engine picks the single
   * best offer and ignores every other scheme on that line, because the business
   * treats them as "this OR that" promotions. Documented as a v1 assumption to be
   * confirmed with finance.
   */
  stackable: boolean;

  /** Lower runs first within a stackable group. */
  priority: number;
}
