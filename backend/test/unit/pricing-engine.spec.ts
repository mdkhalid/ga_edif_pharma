import Decimal from 'decimal.js';
import { Money, ZERO } from '../../src/modules/pricing/domain/money.vo';
import { Scheme, SchemeKind } from '../../src/modules/pricing/domain/scheme.types';
import { priceLines, PriceLineInput, PricingContext, PricedLine } from '../../src/modules/pricing/domain/price-engine';

/**
 * The pricing engine is the foundation every money path (cart, orders, invoice)
 * prices against, and its exit criterion is "cart price ≡ invoice price". Because
 * `priceLines` is a pure, deterministic function of its inputs, that identity
 * holds by construction — these tests pin the invariants so a later refactor
 * cannot quietly break them.
 */

const AS_OF = new Date('2026-09-25T00:00:00Z');
const ALWAYS_VALID: [Date, Date] = [new Date('2020-01-01'), new Date('2030-01-01')];

function pct(id: string, productId: string, percentOff: number, stackable = true, priority = 1): Scheme {
  return { id, kind: 'PERCENTAGE', productId, percentOff, validFrom: ALWAYS_VALID[0], validTo: ALWAYS_VALID[1], stackable, priority };
}
function flat(id: string, productId: string, amount: number, stackable = true, priority = 1): Scheme {
  return { id, kind: 'FLAT', productId, flatOff: new Money(amount), validFrom: ALWAYS_VALID[0], validTo: ALWAYS_VALID[1], stackable, priority };
}

describe('priceLines — hand-picked', () => {
  it('applies a single percentage scheme to a line', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 10, baseUnitPrice: new Money(100) };
    const ctx: PricingContext = { asOf: AS_OF, schemes: [pct('S1', 'P1', 10)] };
    const { lines, grandTotal } = priceLines([input], ctx);

    expect(lines[0]!.discountTotal).toBe('100.00'); // 10% of 100 × 10
    expect(lines[0]!.lineTotal).toBe('900.00');
    expect(grandTotal).toBe('900.00');
    expect(lines[0]!.discounts).toHaveLength(1);
    expect(lines[0]!.discounts[0]!.reason).toContain('10% off');
  });

  it('stacks two percentage schemes in priority order against the running price', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) };
    // 10% off first (priority 1) then 10% off the reduced 90 (priority 2): 100 → 90 → 81.
    const ctx: PricingContext = { asOf: AS_OF, schemes: [pct('S2', 'P1', 10, true, 2), pct('S1', 'P1', 10, true, 1)] };
    const { lines } = priceLines([input], ctx);

    expect(lines[0]!.lineTotal).toBe('81.00');
    expect(lines[0]!.discounts.map((d) => d.schemeId)).toEqual(['S1', 'S2']);
  });

  it('treats non-stackable schemes as exclusive best offer', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) };
    const ctx: PricingContext = {
      asOf: AS_OF,
      schemes: [pct('BIG', 'P1', 30, false), pct('SMALL', 'P1', 10, false)], // both non-stackable
    };
    const { lines } = priceLines([input], ctx);

    expect(lines[0]!.lineTotal).toBe('70.00'); // only the 30% offer applies
    expect(lines[0]!.discounts).toHaveLength(1);
    expect(lines[0]!.discounts[0]!.schemeId).toBe('BIG');
  });

  it('ignores non-applicable schemes (product mismatch, validity, minQty)', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 2, baseUnitPrice: new Money(100) };
    const expired: Scheme = { ...pct('OLD', 'P1', 50), validFrom: new Date('2000-01-01'), validTo: new Date('2001-01-01') };
    const tooFew: Scheme = { ...pct('MIN', 'P1', 50), minQty: 5 };
    const wrongProduct: Scheme = pct('OTHER', 'P2', 50);
    const ctx: PricingContext = { asOf: AS_OF, schemes: [expired, tooFew, wrongProduct] };
    const { lines } = priceLines([input], ctx);

    expect(lines[0]!.lineTotal).toBe('200.00'); // no discount applied
    expect(lines[0]!.discounts).toHaveLength(0);
  });

  it('applies a customer price-list override instead of the catalogue price', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) };
    const ctx: PricingContext = { asOf: AS_OF, schemes: [], priceOverrides: { P1: new Money(80) } };
    const { lines } = priceLines([input], ctx);
    expect(lines[0]!.baseUnitPrice).toBe('80');
    expect(lines[0]!.lineTotal).toBe('80.00');
  });

  it('never lets a line total go negative when discounts overshoot', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) };
    const ctx: PricingContext = { asOf: AS_OF, schemes: [flat('F', 'P1', 200)] }; // ₹200 off a ₹100 line
    const { lines } = priceLines([input], ctx);
    expect(lines[0]!.lineTotal).toBe('0.00');
    expect(new Money(lines[0]!.lineTotal).greaterThanOrEqualTo(ZERO)).toBe(true);
  });
});

describe('priceLines — property tests (seeded)', () => {
  // Deterministic PRNG so a failing random case is reproducible.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PRODUCTS = ['P1', 'P2', 'P3'];
  const CATEGORIES = ['C1', 'C2'];

  function randomContext(rand: () => number): { inputs: PriceLineInput[]; ctx: PricingContext; applicableIds: Set<string> } {
    const nLines = 1 + Math.floor(rand() * 4);
    const inputs: PriceLineInput[] = [];
    for (let i = 0; i < nLines; i++) {
      const p = PRODUCTS[Math.floor(rand() * PRODUCTS.length)]!;
      const c = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
      const qty = 1 + Math.floor(rand() * 15);
      const price = 10 + Math.floor(rand() * 2000);
      inputs.push({ productId: p, categoryId: c, quantity: qty, baseUnitPrice: new Money(price) });
    }

    const nSchemes = Math.floor(rand() * 7);
    const schemes: Scheme[] = [];
    const applicableIds = new Set<string>();
    for (let i = 0; i < nSchemes; i++) {
      const id = `S${i}`;
      const kind: SchemeKind = (['PERCENTAGE', 'FLAT', 'FREE_GOODS', 'COMBO'] as SchemeKind[])[Math.floor(rand() * 4)]!;
      const scopeRoll = rand();
      const productId = scopeRoll < 0.5 ? PRODUCTS[Math.floor(rand() * PRODUCTS.length)] : undefined;
      const categoryId = productId === undefined ? CATEGORIES[Math.floor(rand() * CATEGORIES.length)] : undefined;
      const minQty = 1 + Math.floor(rand() * 10);
      // Only meaningful for FREE_GOODS ("buy N, get M"), but generated for every
      // scheme so the shape is always well formed.
      const buyQty = 1 + Math.floor(rand() * 4);
      const freeQty = 1 + Math.floor(rand() * 3);
      // ~1/4 of schemes are outside the validity window.
      const outside = rand() < 0.25;
      const validFrom = outside ? new Date('2000-01-01') : ALWAYS_VALID[0];
      const validTo = outside ? new Date('2001-01-01') : ALWAYS_VALID[1];
      const scheme: Scheme = {
        id,
        kind,
        productId,
        categoryId,
        percentOff: Math.floor(rand() * 50),
        flatOff: new Money(Math.floor(rand() * 200)),
        minQty,
        buyQty,
        freeQty,
        validFrom,
        validTo,
        stackable: rand() < 0.5,
        priority: Math.floor(rand() * 5),
      };
      schemes.push(scheme);

      const matchesScope = (p: string, c?: string) =>
        (scheme.productId !== undefined ? scheme.productId === p : scheme.categoryId === c);
      const inWindow = !outside;
      for (const input of inputs) {
        if (!inWindow || !matchesScope(input.productId, input.categoryId)) continue;
        const qty = new Decimal(input.quantity);
        if (qty.lessThan(minQty)) continue;
        // A discount kind always reaches the trail. FREE_GOODS reaches it only
        // once a whole "buy" block is met — `floor(qty / buyQty) >= 1` — so a
        // line short of the threshold is correctly absent rather than zero.
        if (kind === 'FREE_GOODS' && qty.lessThan(buyQty)) continue;
        if (kind === 'COMBO') continue; // order-level pass, never a line discount
        applicableIds.add(id);
      }
    }

    const ctx: PricingContext = { asOf: AS_OF, schemes };
    return { inputs, ctx, applicableIds };
  }

  function checkLine(line: PricedLine, applicableIds: Set<string>): void {
    const lineTotal = new Money(line.lineTotal);
    const baseLineTotal = new Money(line.baseLineTotal);
    const discountTotal = new Money(line.discountTotal);
    const qty = new Decimal(line.quantity);
    const trailSum = line.discounts.reduce((acc, d) => acc.plus(d.amount), ZERO);
    const rebuilt = new Money(line.effectiveUnitPrice).times(qty).round();

    // Each broken rule is collected by name rather than asserted one at a time.
    // Six bare `expect(…).toBe(true)` calls all fail identically — "expected true,
    // received false" — and the first one to trip hides the other five. A failure
    // here should read as a list of the rules the engine broke, on the line that
    // broke them.
    const where = `${line.productId} qty ${line.quantity} @ ${line.baseUnitPrice} → ${line.lineTotal}`;
    const broken: string[] = [];

    if (!lineTotal.greaterThanOrEqualTo(ZERO)) broken.push('line total went negative');
    if (!discountTotal.lessThanOrEqualTo(baseLineTotal)) {
      broken.push(`discount ${line.discountTotal} exceeds base line ${line.baseLineTotal}`);
    }
    if (!lineTotal.equals(baseLineTotal.minus(discountTotal).round())) {
      broken.push(`lineTotal ${line.lineTotal} != round(${line.baseLineTotal} − ${line.discountTotal})`);
    }
    if (!trailSum.equals(discountTotal)) {
      broken.push(`trail sums to ${trailSum.toString()} but discountTotal is ${line.discountTotal}`);
    }
    if (!rebuilt.equals(lineTotal)) {
      broken.push(`${line.effectiveUnitPrice} × ${line.quantity} = ${rebuilt.toString()}, not ${line.lineTotal}`);
    }
    for (const d of line.discounts) {
      if (!applicableIds.has(d.schemeId)) broken.push(`scheme ${d.schemeId} was never applicable`);
    }

    // The failing line heads the list, so a report of several rules still says
    // which line broke them.
    if (broken.length > 0) broken.unshift(`on ${where}`);
    expect(broken).toEqual([]);
  }

  it('holds invariants across 2000 random configurations', () => {
    const rand = mulberry32(0xc0ffee);
    for (let iter = 0; iter < 2000; iter++) {
      const { inputs, ctx, applicableIds } = randomContext(rand);
      const result = priceLines(inputs, ctx);

      // Determinism: pricing the same input again is identical.
      const again = priceLines(inputs, ctx);
      expect(JSON.stringify(again)).toBe(JSON.stringify(result));

      let sumLineTotal = ZERO;
      let sumBase = ZERO;
      let sumDiscount = ZERO;
      for (const line of result.lines) {
        checkLine(line, applicableIds);
        sumLineTotal = sumLineTotal.plus(new Money(line.lineTotal));
        sumBase = sumBase.plus(new Money(line.baseLineTotal));
        sumDiscount = sumDiscount.plus(new Money(line.discountTotal));
      }
      // Roll-ups equal the sum of their parts exactly.
      expect(sumLineTotal.equals(new Money(result.grandTotal))).toBe(true);
      expect(sumBase.equals(new Money(result.subtotal))).toBe(true);
      expect(sumDiscount.equals(new Money(result.totalDiscount))).toBe(true);
    }
  });
});

describe('priceLines — P3: free-goods, order-level, combo', () => {
  function free(id: string, productId: string, buyQty: number, freeQty: number): Scheme {
    return {
      id,
      kind: 'FREE_GOODS',
      productId,
      buyQty,
      freeQty,
      validFrom: ALWAYS_VALID[0],
      validTo: ALWAYS_VALID[1],
      stackable: true,
      priority: 1,
    };
  }

  it('grants free units and reduces the payable line total (buy 2 get 1 free)', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 3, baseUnitPrice: new Money(100) };
    const ctx: PricingContext = { asOf: AS_OF, schemes: [free('F1', 'P1', 2, 1)] };
    const { lines } = priceLines([input], ctx);

    expect(lines[0]!.freeQuantity).toBe('1');
    // Pay for 2 of 3: 200, not 300.
    expect(lines[0]!.lineTotal).toBe('200.00');
    expect(lines[0]!.discountTotal).toBe('100.00');
  });

  it('caps free units at the quantity bought (buy 3 get 1, only 2 units)', () => {
    const input: PriceLineInput = { productId: 'P1', quantity: 2, baseUnitPrice: new Money(50) };
    const ctx: PricingContext = { asOf: AS_OF, schemes: [free('F1', 'P1', 3, 1)] };
    const { lines } = priceLines([input], ctx);
    // No whole "buy 3" block is met, so nothing is granted — and the field is
    // *absent* rather than zero, matching `orderDiscount` and the documented
    // shape of `PricedLine.freeQuantity`.
    expect(lines[0]!.freeQuantity).toBeUndefined();
    expect(lines[0]!.discounts).toHaveLength(0);
    expect(lines[0]!.lineTotal).toBe('100.00');
  });

  it('never goes negative when free goods and a discount scheme stack on one line', () => {
    // 1 unit at ₹100, buy 1 get 1 free (the free value is the whole line) plus
    // 10% off. The discount cannot exceed what the line is worth, so the buyer
    // pays zero rather than the line total turning negative.
    const input: PriceLineInput = { productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) };
    const ctx: PricingContext = { asOf: AS_OF, schemes: [free('F1', 'P1', 1, 1), pct('S1', 'P1', 10)] };
    const { lines } = priceLines([input], ctx);

    expect(lines[0]!.lineTotal).toBe('0.00');
    expect(new Money(lines[0]!.discountTotal).lessThanOrEqualTo(new Money('100'))).toBe(true);
    // The trail reports the capped amount, and says so, so the buyer is not shown
    // a ₹100 free-goods discount on a line that only absorbed ₹90 of it.
    const freeEntry = lines[0]!.discounts.find((d) => d.kind === 'FREE_GOODS');
    expect(freeEntry!.amount.toString()).toBe('90.00');
    expect(freeEntry!.reason).toContain('capped');
  });

  it('applies an order-level percentage discount once to the subtotal', () => {
    const inputs: PriceLineInput[] = [
      { productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) },
      { productId: 'P2', quantity: 1, baseUnitPrice: new Money(100) },
    ];
    const orderScheme: Scheme = {
      id: 'O1',
      kind: 'PERCENTAGE',
      percentOff: 10,
      validFrom: ALWAYS_VALID[0],
      validTo: ALWAYS_VALID[1],
      stackable: true,
      priority: 1,
    };
    const ctx: PricingContext = { asOf: AS_OF, schemes: [orderScheme] };
    const result = priceLines(inputs, ctx);

    // 10% of 200 = 20 off the whole order.
    expect(result.orderDiscount).toBe('20.00');
    expect(result.grandTotal).toBe('180.00');
  });

  it('applies a combo discount only when every combo product is present', () => {
    const inputs: PriceLineInput[] = [
      { productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) },
      { productId: 'P2', quantity: 1, baseUnitPrice: new Money(100) },
    ];
    const combo: Scheme = {
      id: 'C1',
      kind: 'COMBO',
      comboProductIds: ['P1', 'P2'],
      percentOff: 25,
      validFrom: ALWAYS_VALID[0],
      validTo: ALWAYS_VALID[1],
      stackable: true,
      priority: 1,
    };

    // Both present ⇒ 25% of the 200 combo base = 50 off.
    const withCombo = priceLines(inputs, { asOf: AS_OF, schemes: [combo] });
    expect(withCombo.orderDiscount).toBe('50.00');
    expect(withCombo.grandTotal).toBe('150.00');

    // Missing P2 ⇒ combo not eligible ⇒ no order discount.
    const missing = priceLines([inputs[0]!], { asOf: AS_OF, schemes: [combo] });
    expect(missing.orderDiscount).toBeUndefined();
    expect(missing.grandTotal).toBe('100.00');
  });
});
