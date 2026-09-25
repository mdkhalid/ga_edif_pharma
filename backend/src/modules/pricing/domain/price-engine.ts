import Decimal from 'decimal.js';
import { Money, ZERO } from './money.vo';
import { Scheme, SchemeKind } from './scheme.types';

export interface PriceLineInput {
  productId: string;
  categoryId?: string;
  /** Exact quantity (supports fractional units like strips). */
  quantity: Decimal.Value;
  /** Catalogue base unit price before any price-list/tier override. */
  baseUnitPrice: Money;
}

export interface PricingContext {
  /** The instant at which pricing is evaluated (scheme validity is relative to it). */
  asOf: Date;
  schemes: Scheme[];
  /**
   * Customer / price-list / tier overrides keyed by productId. This is exactly
   * the slot P2's pricing repository populates; the engine stays agnostic to
   * where the override came from. `undefined` ⇒ use the line's `baseUnitPrice`.
   */
  priceOverrides?: Record<string, Money>;
}

export interface AppliedDiscount {
  schemeId: string;
  kind: SchemeKind;
  /** Discount attributed to this whole line (per-unit × quantity). */
  amount: Money;
  /** Human-readable reason, shown in the UI explanation trail. */
  reason: string;
}

export interface PricedLine {
  productId: string;
  quantity: string;
  baseUnitPrice: string;
  /** Exact (unrounded) effective per-unit price. */
  effectiveUnitPrice: string;
  /** Paisa-rounded line total — the source of truth that cart and invoice share. */
  lineTotal: string;
  /** Sum of `discounts[].amount` (raw, before the line-level clamp). */
  discountTotal: string;
  /** Paisa-rounded base line total, before discounts. */
  baseLineTotal: string;
  discounts: AppliedDiscount[];
}

export interface PricingResult {
  lines: PricedLine[];
  /** Sum of base line totals. */
  subtotal: string;
  /** Sum of (raw) discount totals. */
  totalDiscount: string;
  /** Sum of line totals — equal to subtotal − totalDiscount, paisa-rounded per line. */
  grandTotal: string;
}

function quantityOf(input: PriceLineInput): Decimal {
  return new Decimal(input.quantity);
}

function isApplicable(scheme: Scheme, input: PriceLineInput, qty: Decimal, asOf: Date): boolean {
  if (scheme.validFrom > asOf || scheme.validTo < asOf) return false;
  const minQty = scheme.minQty ?? 1;
  if (qty.lessThan(minQty)) return false;
  if (scheme.productId !== undefined && scheme.productId !== input.productId) return false;
  if (scheme.categoryId !== undefined && scheme.categoryId !== input.categoryId) return false;
  return true;
}

/** Discount on the whole line for a single scheme, evaluated against the base unit. */
function discountForScheme(scheme: Scheme, baseUnit: Money, qty: Decimal): Money {
  if (scheme.kind === 'PERCENTAGE') {
    const pct = new Decimal(scheme.percentOff ?? 0).div(100);
    return baseUnit.times(pct).times(qty);
  }
  if (scheme.kind === 'FLAT') {
    return (scheme.flatOff ?? ZERO).times(qty);
  }
  // FREE_GOODS / COMBO are not line-discount kinds yet (P3).
  return ZERO;
}

function reasonFor(scheme: Scheme): string {
  if (scheme.kind === 'PERCENTAGE') return `Scheme ${scheme.id}: ${scheme.percentOff ?? 0}% off`;
  if (scheme.kind === 'FLAT') return `Scheme ${scheme.id}: ₹${(scheme.flatOff ?? ZERO).toString()} off/unit`;
  return `Scheme ${scheme.id}`;
}

/**
 * Apply stackable schemes in priority order against a *running* unit price, so a
 * later scheme discounts the already-reduced price. The running price is clamped
 * at zero per step so a line can never be discounted below free. Returns the raw
 * sum of discount amounts plus the per-scheme trail.
 */
function applyStackable(stackable: Scheme[], baseUnit: Money, qty: Decimal): { discounts: AppliedDiscount[]; total: Money } {
  const ordered = [...stackable].sort((a, b) => a.priority - b.priority);
  const discounts: AppliedDiscount[] = [];
  let runningUnit = baseUnit;
  let total = ZERO;

  for (const scheme of ordered) {
    let perUnit: Money;
    if (scheme.kind === 'PERCENTAGE') {
      const pct = new Decimal(scheme.percentOff ?? 0).div(100);
      perUnit = runningUnit.times(pct);
    } else if (scheme.kind === 'FLAT') {
      perUnit = scheme.flatOff ?? ZERO;
    } else {
      continue;
    }
    // Clamp so the running unit price never goes negative.
    if (perUnit.greaterThan(runningUnit)) perUnit = runningUnit;
    runningUnit = runningUnit.minus(perUnit);
    const amount = perUnit.times(qty).round();
    total = total.plus(amount);
    discounts.push({ schemeId: scheme.id, kind: scheme.kind, amount, reason: reasonFor(scheme) });
  }

  return { discounts, total };
}

/**
 * Non-stackable schemes are mutually exclusive: pick the single best offer and
 * ignore all others on this line.
 */
function applyNonStackable(nonStackable: Scheme[], baseUnit: Money, qty: Decimal): { discounts: AppliedDiscount[]; total: Money } {
  let best: Scheme | null = null;
  let bestAmount = ZERO;
  for (const scheme of nonStackable) {
    let amount = discountForScheme(scheme, baseUnit, qty).round();
    if (amount.greaterThan(baseUnit.times(qty))) amount = baseUnit.times(qty); // clamp to line value
    if (amount.greaterThan(bestAmount)) {
      bestAmount = amount;
      best = scheme;
    }
  }
  if (!best) return { discounts: [], total: ZERO };
  return {
    discounts: [{ schemeId: best.id, kind: best.kind, amount: bestAmount, reason: reasonFor(best) }],
    total: bestAmount,
  };
}

function priceLine(input: PriceLineInput, ctx: PricingContext): PricedLine {
  const qty = quantityOf(input);
  const baseUnit = ctx.priceOverrides?.[input.productId] ?? input.baseUnitPrice;
  const baseLineTotal = baseUnit.times(qty);

  const applicable = ctx.schemes.filter((s) => isApplicable(s, input, qty, ctx.asOf));
  const stackable = applicable.filter((s) => s.stackable);
  const nonStackable = applicable.filter((s) => !s.stackable);

  const applied = nonStackable.length > 0 ? applyNonStackable(nonStackable, baseUnit, qty) : applyStackable(stackable, baseUnit, qty);

  const lineTotal = baseLineTotal.minus(applied.total).round();
  const effectiveUnit = qty.isZero() ? baseUnit : lineTotal.dividedBy(qty);

  return {
    productId: input.productId,
    quantity: qty.toString(),
    baseUnitPrice: baseUnit.toRaw(),
    effectiveUnitPrice: effectiveUnit.toRaw(),
    lineTotal: lineTotal.toString(),
    baseLineTotal: baseLineTotal.round().toString(),
    discountTotal: applied.total.toString(),
    discounts: applied.discounts,
  };
}

/**
 * Pure, deterministic line pricer. Same inputs ⇒ same output, which is what makes
 * "the price in the cart equals the price on the invoice" hold by construction.
 * No I/O, no clock beyond the explicit `asOf` in the context.
 */
export function priceLines(inputs: PriceLineInput[], ctx: PricingContext): PricingResult {
  const lines = inputs.map((input) => priceLine(input, ctx));

  let subtotal = ZERO;
  let totalDiscount = ZERO;
  let grandTotal = ZERO;
  for (const line of lines) {
    subtotal = subtotal.plus(new Money(line.baseLineTotal));
    totalDiscount = totalDiscount.plus(new Money(line.discountTotal));
    grandTotal = grandTotal.plus(new Money(line.lineTotal));
  }

  return {
    lines,
    subtotal: subtotal.toString(),
    totalDiscount: totalDiscount.toString(),
    grandTotal: grandTotal.toString(),
  };
}
