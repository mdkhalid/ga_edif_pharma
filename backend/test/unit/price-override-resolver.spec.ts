import { Money } from '../../src/modules/pricing/domain/money.vo';
import { resolvePriceOverrideMap } from '../../src/modules/pricing/application/price-override-resolver';

/**
 * The override resolver is pure: given plain data (no Prisma), it must pick the
 * right per-product price and nothing else. These tests pin the precedence rules
 * that the Prisma adapter relies on, so a refactor of either side cannot quietly
 * change which price a customer is charged.
 */
describe('resolvePriceOverrideMap', () => {
  it('returns an empty map when the customer has no overrides and no price list', () => {
    const map = resolvePriceOverrideMap({
      directOverrides: new Map(),
      priceList: null,
      lines: [{ productId: 'P1', quantity: 5 }],
    });
    expect(map).toEqual({});
  });

  it('applies a direct customer override and omits products without one', () => {
    const map = resolvePriceOverrideMap({
      directOverrides: new Map([['P1', '90']]),
      priceList: null,
      lines: [
        { productId: 'P1', quantity: 2 },
        { productId: 'P2', quantity: 2 },
      ],
    });
    expect(map).toEqual({ P1: new Money(90) });
  });

  it('lets a direct override beat an assigned price list', () => {
    const map = resolvePriceOverrideMap({
      directOverrides: new Map([['P1', '80']]),
      priceList: { lines: [{ productId: 'P1', minQty: 1, unitPrice: '100' }] },
      lines: [{ productId: 'P1', quantity: 10 }],
    });
    expect(map.P1!.toRaw()).toBe('80');
  });

  it('selects the highest qualifying quantity tier of the price list', () => {
    const map = resolvePriceOverrideMap({
      directOverrides: new Map(),
      priceList: {
        lines: [
          { productId: 'P1', minQty: 1, unitPrice: '100' },
          { productId: 'P1', minQty: 10, unitPrice: '90' },
          { productId: 'P1', minQty: 50, unitPrice: '80' },
        ],
      },
      lines: [{ productId: 'P1', quantity: 12 }],
    });
    // 12 meets the 10-tier but not the 50-tier, so 90 wins.
    expect(map.P1!.toRaw()).toBe('90');
  });

  it('falls back to the base tier when the quantity is too small for any tier', () => {
    const map = resolvePriceOverrideMap({
      directOverrides: new Map(),
      priceList: {
        lines: [
          { productId: 'P1', minQty: 10, unitPrice: '90' },
          { productId: 'P1', minQty: 50, unitPrice: '80' },
        ],
      },
      lines: [{ productId: 'P1', quantity: 3 }],
    });
    expect(map).toEqual({});
  });

  it('ignores a price list passed as null (effective-dating is the adapter\'s job)', () => {
    const map = resolvePriceOverrideMap({
      directOverrides: new Map(),
      priceList: null,
      lines: [{ productId: 'P1', quantity: 100 }],
    });
    expect(map).toEqual({});
  });
});
