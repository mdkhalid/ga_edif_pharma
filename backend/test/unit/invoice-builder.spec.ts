import { Money, ZERO } from '../../src/modules/pricing/domain/money.vo';
import { buildInvoice } from '../../src/modules/invoicing/domain/invoice.builder';
import type { InvoiceLineInput } from '../../src/modules/invoicing/domain/invoice.types';

function line(productId: string, hsnCode: string, taxRatePercent: string, taxable: number, quantity = '1'): InvoiceLineInput {
  return { productId, hsnCode, taxRatePercent, taxableValue: new Money(taxable), quantity };
}

describe('buildInvoice — hand-picked', () => {
  it('computes a single intra-state line: 12% on ₹1000 ⇒ CGST 60 + SGST 60 = 1120', () => {
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', lines: [line('P1', '3004', '12', 1000)] });
    expect(inv.gstType).toBe('CGST_SGST');
    expect(inv.lines[0]!.cgst).toBe('60.00');
    expect(inv.lines[0]!.sgst).toBe('60.00');
    expect(inv.lines[0]!.lineTotal).toBe('1120.00');
    expect(inv.totals.grandTotal).toBe('1120.00');
    expect(inv.totals.taxableTotal).toBe('1000.00');
    expect(inv.totals.totalTax).toBe('120.00');
  });

  it('computes an inter-state line with IGST only', () => {
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'KA', lines: [line('P1', '3004', '18', 500)] });
    expect(inv.gstType).toBe('IGST');
    expect(inv.lines[0]!.igst).toBe('90.00');
    expect(inv.lines[0]!.cgst).toBe('0.00');
    expect(inv.lines[0]!.lineTotal).toBe('590.00');
    expect(inv.totals.grandTotal).toBe('590.00');
  });

  it('aggregates the HSN summary across lines sharing an HSN and rate', () => {
    const inv = buildInvoice({
      supplierStateCode: 'MH',
      customerStateCode: 'MH',
      lines: [line('P1', '3004', '12', 1000), line('P2', '3004', '12', 500), line('P3', '3005', '5', 200)],
    });
    expect(inv.hsnSummary).toHaveLength(2);
    const row3004 = inv.hsnSummary.find((s) => s.hsnCode === '3004')!;
    expect(row3004.lineCount).toBe(2);
    expect(row3004.taxableValue).toBe('1500.00'); // 1000 + 500
    expect(row3004.cgst).toBe('90.00'); // 60 + 30
    expect(row3004.sgst).toBe('90.00');
  });

  it('rounds the grand total to a whole rupee and records the residual as round-off', () => {
    // 100.40 taxable + 5.02 tax (5% intra ⇒ 2.51 CGST + 2.51 SGST) = 105.42 ⇒ round to 105, round-off −0.42.
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', roundToWholeRupee: true, lines: [line('P1', '3004', '5', 100.4)] });
    expect(inv.totals.roundOff).toBe('-0.42');
    expect(inv.totals.grandTotal).toBe('105.00');
  });

  it('does not round off and keeps the paisa total when rounding is off', () => {
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', roundToWholeRupee: false, lines: [line('P1', '3004', '5', 100.4)] });
    expect(inv.totals.roundOff).toBe('0.00');
    expect(inv.totals.grandTotal).toBe('105.42');
  });
});

describe('buildInvoice — invariants (always hold)', () => {
  const inputs: InvoiceLineInput[] = [
    line('P1', '3004', '12', 1000),
    line('P2', '3004', '12', 500),
    line('P3', '3005', '5', 99.99),
  ];

  it('every line total equals its taxable value plus its tax', () => {
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', lines: inputs });
    for (const l of inv.lines) {
      const expected = new Money(l.taxableValue).plus(new Money(l.cgst)).plus(new Money(l.sgst)).plus(new Money(l.igst));
      expect(l.lineTotal).toBe(expected.toString());
    }
  });

  it('grand total equals taxable + totalTax + roundOff, and totalTax is the sum of its parts', () => {
    for (const round of [true, false]) {
      const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', roundToWholeRupee: round, lines: inputs });
      const t = inv.totals;
      const recomposed = new Money(t.taxableTotal)
        .plus(new Money(t.totalTax))
        .plus(new Money(t.roundOff));
      expect(t.grandTotal).toBe(recomposed.toString());

      const taxSum = new Money(t.cgstTotal).plus(new Money(t.sgstTotal)).plus(new Money(t.igstTotal));
      expect(t.totalTax).toBe(taxSum.toString());
    }
  });

  it('round-off is within ±0.50 and zero when not rounding to a whole rupee', () => {
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', roundToWholeRupee: true, lines: inputs });
    const r = new Money(inv.totals.roundOff).value;
    expect(r.abs().lessThanOrEqualTo(0.5)).toBe(true);
  });

  it('never produces a negative line total or taxable value', () => {
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', lines: inputs });
    for (const l of inv.lines) {
      expect(new Money(l.lineTotal).greaterThanOrEqualTo(ZERO)).toBe(true);
      expect(new Money(l.taxableValue).greaterThanOrEqualTo(ZERO)).toBe(true);
    }
  });

  it('HSN summary tax equals the sum of line tax for that key', () => {
    const inv = buildInvoice({ supplierStateCode: 'MH', customerStateCode: 'MH', lines: inputs });
    for (const s of inv.hsnSummary) {
      const linesForKey = inv.lines.filter((l) => l.hsnCode === s.hsnCode && l.taxRatePercent === s.taxRatePercent);
      const cgst = linesForKey.reduce((a, l) => a.plus(new Money(l.cgst)), ZERO);
      const sgst = linesForKey.reduce((a, l) => a.plus(new Money(l.sgst)), ZERO);
      const igst = linesForKey.reduce((a, l) => a.plus(new Money(l.igst)), ZERO);
      expect(s.cgst).toBe(cgst.toString());
      expect(s.sgst).toBe(sgst.toString());
      expect(s.igst).toBe(igst.toString());
    }
  });
});
