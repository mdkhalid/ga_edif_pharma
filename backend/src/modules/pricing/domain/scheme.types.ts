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
