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
  /**
   * Products present on the order, used for COMBO eligibility. Derived from the
   * inputs automatically when omitted, so callers need not supply it.
   */
  orderProductIds?: string[];
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
  /** Units granted free by a FREE_GOODS scheme (absent when none). */
  freeQuantity?: string;
}

export interface PricingResult {
  lines: PricedLine[];
  /** Sum of base line totals. */
  subtotal: string;
  /** Sum of (raw) line discount totals (percentage/flat + free-goods value). */
  totalDiscount: string;
  /** Order-level + COMBO scheme discount, applied to the whole order once. */
  orderDiscount?: string;
  /** Sum of line totals — equal to subtotal − totalDiscount − orderDiscount. */
  grandTotal: string;
}

function quantityOf(input: PriceLineInput): Decimal {
  return new Decimal(input.quantity);
}

/**
 * A scheme is *line-level* when it targets a product or category. Order-level
 * schemes (no product/category target) and COMBO schemes (matched across the
 * whole order by `comboProductIds`) are handled in a separate order-level pass,
 * never inside the per-line loop.
 */
function isLineScheme(scheme: Scheme): boolean {
  return scheme.kind !== 'COMBO' && (scheme.productId !== undefined || scheme.categoryId !== undefined);
}

function isApplicable(scheme: Scheme, input: PriceLineInput, qty: Decimal, asOf: Date): boolean {
  if (scheme.validFrom > asOf || scheme.validTo < asOf) return false;
  const minQty = scheme.minQty ?? 1;
  if (qty.lessThan(minQty)) return false;
  if (scheme.productId !== undefined && scheme.productId !== input.productId) return false;
  if (scheme.categoryId !== undefined && scheme.categoryId !== input.categoryId) return false;
  return true;
}

/** Discount on the whole line for a single percentage/flat scheme, against the base unit. */
function discountForScheme(scheme: Scheme, baseUnit: Money, qty: Decimal): Money {
  if (scheme.kind === 'PERCENTAGE') {
    const pct = new Decimal(scheme.percentOff ?? 0).div(100);
    return baseUnit.times(pct).times(qty);
  }
  if (scheme.kind === 'FLAT') {
    return (scheme.flatOff ?? ZERO).times(qty);
  }
  return ZERO;
}

function reasonFor(scheme: Scheme): string {
  if (scheme.kind === 'PERCENTAGE') return `Scheme ${scheme.id}: ${scheme.percentOff ?? 0}% off`;
  if (scheme.kind === 'FLAT') return `Scheme ${scheme.id}: ₹${(scheme.flatOff ?? ZERO).toString()} off/unit`;
  if (scheme.kind === 'FREE_GOODS') {
    const buy = scheme.buyQty ?? 1;
    const free = scheme.freeQty ?? 1;
    return `Scheme ${scheme.id}: buy ${buy} get ${free} free`;
  }
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

interface FreeGrant {
  readonly scheme: Scheme;
  units: Decimal;
}

/**
 * The free units each FREE_GOODS scheme grants, aggregated and capped at the
 * quantity bought.
 *
 * Returns one entry per scheme that actually grants something, rather than a
 * single total: the explanation trail has to name the scheme responsible for each
 * unit. Collapsing them first meant the trail credited `freeSchemes[0]` even when
 * *it* was the scheme whose buy-threshold the line never met — so a buyer could be
 * shown "buy 4 get 1 free" against a line of 2.
 *
 * The cap is applied from the last grant backwards, so the surplus is taken off the
 * schemes that would have pushed the line over `qty` and the earlier ones keep
 * their full entitlement.
 */
function freeGrants(freeSchemes: Scheme[], qty: Decimal): FreeGrant[] {
  const grants: FreeGrant[] = [];
  for (const scheme of freeSchemes) {
    const buy = scheme.buyQty ?? 1;
    const give = scheme.freeQty ?? 1;
    if (buy <= 0 || give <= 0) continue;
    const units = qty.div(buy).floor().times(give);
    if (units.isZero()) continue;
    grants.push({ scheme, units });
  }

  let budget = qty;
  for (let i = grants.length - 1; i >= 0; i--) {
    const grant = grants[i]!;
    if (grant.units.lessThanOrEqualTo(budget)) {
      budget = budget.minus(grant.units);
      continue;
    }
    grant.units = budget;
    budget = new Decimal(0);
  }

  return grants.filter((grant) => grant.units.isPositive());
}

function priceLine(input: PriceLineInput, ctx: PricingContext): PricedLine {
  const qty = quantityOf(input);
  const baseUnit = ctx.priceOverrides?.[input.productId] ?? input.baseUnitPrice;
  const baseLineTotal = baseUnit.times(qty);

  const lineSchemes = ctx.schemes.filter((s) => isLineScheme(s) && isApplicable(s, input, qty, ctx.asOf));
  const discountSchemes = lineSchemes.filter((s) => s.kind === 'PERCENTAGE' || s.kind === 'FLAT');
  const freeSchemes = lineSchemes.filter((s) => s.kind === 'FREE_GOODS');

  const applied = discountSchemes.length > 0
    ? (discountSchemes.some((s) => !s.stackable)
        ? applyNonStackable(discountSchemes.filter((s) => !s.stackable), baseUnit, qty)
        : applyStackable(discountSchemes.filter((s) => s.stackable), baseUnit, qty))
    : { discounts: [] as AppliedDiscount[], total: ZERO };

  // Free goods can only discount what the line is still worth. Buy 1 get 1 free
  // *and* 10% off is the case that overflows: the raw free value can exceed the
  // line, and subtracting it unclamped produced a negative line total — the one
  // thing this engine promises never to do. Clamping grant by grant (rather than
  // clamping one lump sum) keeps every entry attributed and makes the trail sum
  // exactly to the discount, which is what the invariants check.
  const grants = freeGrants(freeSchemes, qty);
  let freeBudget = Money.max(baseLineTotal.minus(applied.total), ZERO);
  const freeDiscount: AppliedDiscount[] = [];
  let freeUnits = new Decimal(0);
  for (const grant of grants) {
    const raw = baseUnit.times(grant.units).round();
    const value = Money.min(freeBudget, raw);
    freeBudget = freeBudget.minus(value);
    freeUnits = freeUnits.plus(grant.units);
    // A grant the line cannot absorb moves no money, so it stays out of the trail
    // rather than showing the buyer an offer that did nothing.
    if (value.isZero()) continue;
    freeDiscount.push({
      schemeId: grant.scheme.id,
      kind: 'FREE_GOODS',
      amount: value,
      reason: value.lessThan(raw)
        ? `${reasonFor(grant.scheme)} — capped to the amount the line can absorb`
        : reasonFor(grant.scheme),
    });
  }
  const freeValue = freeDiscount.reduce((acc, d) => acc.plus(d.amount), ZERO);

  const discountTotal = applied.total.plus(freeValue);
  const lineTotal = Money.max(baseLineTotal.minus(discountTotal), ZERO).round();
  const effectiveUnit = qty.isZero() ? baseUnit : lineTotal.dividedBy(qty);

  return {
    productId: input.productId,
    quantity: qty.toString(),
    baseUnitPrice: baseUnit.toRaw(),
    effectiveUnitPrice: effectiveUnit.toRaw(),
    lineTotal: lineTotal.toString(),
    baseLineTotal: baseLineTotal.round().toString(),
    discountTotal: discountTotal.toString(),
    discounts: [...applied.discounts, ...freeDiscount],
    ...(freeUnits.isZero() ? {} : { freeQuantity: freeUnits.toString() }),
  };
}

/**
 * The money a PERCENTAGE / FLAT / COMBO scheme takes off `base`.
 *
 * For the two line kinds the *kind* names the offer shape. `COMBO` does not — it
 * names the eligibility rule ("all these products on one order"), and the offer
 * it carries is whichever of `percentOff` / `flatOff` is set. Branching on `kind`
 * alone therefore sent a percentage combo down the flat path, and it priced at
 * zero, which is the kind of bug that only ever shows up as a missed discount.
 */
function offerOff(scheme: Scheme, base: Money): Money {
  const isPercentage = scheme.kind === 'PERCENTAGE' || (scheme.kind === 'COMBO' && scheme.percentOff !== undefined);
  if (isPercentage) return base.times(new Decimal(scheme.percentOff ?? 0).div(100)).round();
  return scheme.flatOff ?? ZERO;
}

/**
 * Order-level pass: schemes that span the whole order rather than a single line.
 *
 *  - **Order-level** schemes (no product/category target): a percentage/flat
 *    discount on the order subtotal, applied once.
 *  - **COMBO** schemes: eligible only when every product in `comboProductIds` is
 *    on the order; the discount (percentage/flat) applies to the sum of the
 *    combo lines' base totals.
 *
 * Treated as mutually exclusive (non-stackable): the single best offer wins.
 */
function resolveOrderDiscount(schemes: Scheme[], lines: PricedLine[], present: Set<string>, subtotal: Money): Money {
  const candidates: Money[] = [];

  for (const scheme of schemes) {
    const isOrderLevel = (scheme.kind === 'PERCENTAGE' || scheme.kind === 'FLAT') &&
      scheme.productId === undefined && scheme.categoryId === undefined;
    const isCombo = scheme.kind === 'COMBO' &&
      Array.isArray(scheme.comboProductIds) &&
      scheme.comboProductIds.length > 0 &&
      scheme.comboProductIds.every((id) => present.has(id));

    if (!isOrderLevel && !isCombo) continue;

    let base = subtotal;
    if (isCombo) {
      base = ZERO;
      for (const line of lines) {
        if (scheme.comboProductIds!.includes(line.productId)) {
          base = base.plus(new Money(line.baseLineTotal));
        }
      }
    }

    let amount = offerOff(scheme, base);
    if (amount.greaterThan(base)) amount = base; // clamp to the discounted base
    candidates.push(amount);
  }

  return candidates.reduce((best, amt) => (amt.greaterThan(best) ? amt : best), ZERO);
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
  for (const line of lines) {
    subtotal = subtotal.plus(new Money(line.baseLineTotal));
    totalDiscount = totalDiscount.plus(new Money(line.discountTotal));
  }

  const present = ctx.orderProductIds
    ? new Set(ctx.orderProductIds)
    : new Set(inputs.map((i) => i.productId));
  const orderDiscount = resolveOrderDiscount(ctx.schemes, lines, present, subtotal);

  const grandTotal = subtotal.minus(totalDiscount).minus(orderDiscount).round();

  return {
    lines,
    subtotal: subtotal.toString(),
    totalDiscount: totalDiscount.toString(),
    ...(orderDiscount.isZero() ? {} : { orderDiscount: orderDiscount.toString() }),
    grandTotal: grandTotal.toString(),
  };
}
