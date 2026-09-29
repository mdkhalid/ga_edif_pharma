import { Money, ZERO } from '../../src/modules/pricing/domain/money.vo';
import { distributeDiscount } from '../../src/modules/invoicing/application/discount-distribution';

describe('distributeDiscount', () => {
  it('returns the inputs untouched when the discount is zero', () => {
    const out = distributeDiscount([new Money(100), new Money(50)], ZERO);
    expect(out.map((m) => m.toString())).toEqual(['100.00', '50.00']);
  });

  it('distributes proportionally and sums exactly to taxable − discount', () => {
    const out = distributeDiscount([new Money(1000), new Money(500), new Money(99.99)], new Money(100));
    const sum = out.reduce((a, m) => a.plus(m), ZERO);
    expect(sum.toString()).toBe('1499.99'); // 1599.99 − 100
  });

  it('clamps a discount larger than the taxable sum so no line goes negative', () => {
    const out = distributeDiscount([new Money(100), new Money(50)], new Money(1000));
    expect(out.map((m) => m.toString())).toEqual(['0.00', '0.00']);
  });

  it('never produces a negative line', () => {
    const out = distributeDiscount([new Money('0.01'), new Money(1000)], new Money(500));
    for (const m of out) {
      expect(m.greaterThanOrEqualTo(ZERO)).toBe(true);
    }
  });
});
