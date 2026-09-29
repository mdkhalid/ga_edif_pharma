import { Money, ZERO } from '../../src/modules/pricing/domain/money.vo';
import { isIntraState, splitGst } from '../../src/modules/invoicing/domain/tax';

describe('isIntraState', () => {
  it('is intra-state when supplier and customer share a state code (case-insensitive)', () => {
    expect(isIntraState('MH', 'mh')).toBe(true);
    expect(isIntraState('KA', 'MH')).toBe(false);
  });

  it('throws when either state code is missing', () => {
    expect(() => isIntraState('', 'MH')).toThrow();
    expect(() => isIntraState('MH', '')).toThrow();
  });
});

describe('splitGst — intra-state (CGST + SGST)', () => {
  it('splits a 12% rate into equal CGST and SGST', () => {
    const r = splitGst('MH', 'MH', 12, new Money(1000));
    expect(r.gstType).toBe('CGST_SGST');
    expect(r.cgst.toString()).toBe('60.00');
    expect(r.sgst.toString()).toBe('60.00');
    expect(r.igst.toString()).toBe('0.00');
    expect(r.totalTax.toString()).toBe('120.00');
  });

  it('rounds each half independently to the paisa', () => {
    // 6% of 99.99 = 5.9994 → 6.00 each.
    const r = splitGst('MH', 'MH', 12, new Money('99.99'));
    expect(r.cgst.toString()).toBe('6.00');
    expect(r.sgst.toString()).toBe('6.00');
    expect(r.totalTax.toString()).toBe('12.00');
  });

  it('handles a fractional rate (5% → 2.5% each)', () => {
    const r = splitGst('MH', 'MH', 5, new Money(100));
    expect(r.cgst.toString()).toBe('2.50');
    expect(r.sgst.toString()).toBe('2.50');
  });
});

describe('splitGst — inter-state (IGST)', () => {
  it('levies IGST at the full rate and no CGST/SGST', () => {
    const r = splitGst('MH', 'KA', 18, new Money(500));
    expect(r.gstType).toBe('IGST');
    expect(r.igst.toString()).toBe('90.00');
    expect(r.cgst.toString()).toBe('0.00');
    expect(r.sgst.toString()).toBe('0.00');
    expect(r.totalTax.toString()).toBe('90.00');
  });

  it('a zero taxable value yields zero tax in every bucket', () => {
    const r = splitGst('MH', 'KA', 18, ZERO);
    expect(r.totalTax.isZero()).toBe(true);
    expect(r.igst.isZero()).toBe(true);
  });
});
