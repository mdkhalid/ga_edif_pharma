import { fiscalYearFor, formatInvoiceNumber, nextGaplessSequence } from '../../src/modules/invoicing/domain/invoice-numbering';

describe('fiscalYearFor', () => {
  it('maps an April date to the fiscal year starting that calendar year', () => {
    expect(fiscalYearFor(new Date('2026-04-01T00:00:00Z'))).toBe('2026-27');
  });
  it('maps a March date to the preceding fiscal year', () => {
    expect(fiscalYearFor(new Date('2026-03-31T23:59:59Z'))).toBe('2025-26');
  });
  it('is stable across timezones (UTC-based)', () => {
    expect(fiscalYearFor(new Date('2027-01-15T00:00:00Z'))).toBe('2026-27');
  });
});

describe('formatInvoiceNumber', () => {
  it('produces a zero-padded gapless number', () => {
    expect(formatInvoiceNumber(123, '2026-27')).toBe('INV/2026-27/000123');
  });
  it('honours a custom prefix', () => {
    expect(formatInvoiceNumber(7, '2025-26', 'TAX')).toBe('TAX/2025-26/000007');
  });
  it('rejects a non-positive sequence (gapless numbering requires a real number)', () => {
    expect(() => formatInvoiceNumber(0, '2026-27')).toThrow();
    expect(() => formatInvoiceNumber(-1, '2026-27')).toThrow();
  });
});

describe('nextGaplessSequence', () => {
  it('advances by exactly one', () => {
    expect(nextGaplessSequence(42)).toBe(43);
  });
  it('rejects a negative current value', () => {
    expect(() => nextGaplessSequence(-1)).toThrow();
  });
});
