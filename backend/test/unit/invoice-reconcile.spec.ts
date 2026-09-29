import Decimal from 'decimal.js';
import { Money, ZERO } from '../../src/modules/pricing/domain/money.vo';
import { buildInvoice } from '../../src/modules/invoicing/domain/invoice.builder';
import type { BuildInvoiceInput, InvoiceLineInput } from '../../src/modules/invoicing/domain/invoice.types';

/**
 * Exit criterion for P7: "Invoice totals reconcile to the paisa against an
 * independently computed expected value for 1,000 generated orders."
 *
 * `buildInvoice` is the system under test. `referenceTotals` is a deliberately
 * separate, straightforward re-implementation (no shared helper with the builder),
 * so a rounding regression in the builder cannot also silently infect the oracle.
 * The assertion is exact string equality on every total and every line, so a single
 * paisa of drift fails the whole run.
 */

// Deterministic PRNG so a failing random order is reproducible.
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

const HSNS = ['3004', '3005', '3006', '2939', '2101'];
const RATES = ['0', '5', '12', '18', '12.5', '28'];
const STATES = ['MH', 'KA', 'TN', 'GJ', 'UP'];

function round2(m: Money): Money {
  return m.round();
}

/** Independent reference implementation of the same tax + rounding rules. */
function referenceTotals(input: BuildInvoiceInput): {
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  totalTax: string;
  roundOff: string;
  grandTotal: string;
  lineTotals: string[];
} {
  const intra = input.supplierStateCode.toUpperCase() === input.customerStateCode.toUpperCase();
  let taxableTotal = ZERO;
  let cgstTotal = ZERO;
  let sgstTotal = ZERO;
  let igstTotal = ZERO;
  const lineTotals: string[] = [];

  for (const l of input.lines) {
    const rate = new Decimal(l.taxRatePercent);
    const taxable = l.taxableValue;
    let cgst = ZERO;
    let sgst = ZERO;
    let igst = ZERO;
    if (intra) {
      cgst = taxable.times(rate.div(2).div(100)).round();
      sgst = taxable.times(rate.div(2).div(100)).round();
    } else {
      igst = taxable.times(rate.div(100)).round();
    }
    taxableTotal = taxableTotal.plus(taxable);
    cgstTotal = cgstTotal.plus(cgst);
    sgstTotal = sgstTotal.plus(sgst);
    igstTotal = igstTotal.plus(igst);
    lineTotals.push(taxable.plus(cgst).plus(sgst).plus(igst).round().toString());
  }

  const totalTax = cgstTotal.plus(sgstTotal).plus(igstTotal);
  const raw = taxableTotal.plus(totalTax);

  let roundOff = ZERO;
  let grandTotal = round2(raw);
  if (input.roundToWholeRupee) {
    const rounded = new Money(raw.value.toDecimalPlaces(0));
    roundOff = rounded.minus(round2(raw));
    grandTotal = rounded;
  }

  return {
    taxableTotal: taxableTotal.toString(),
    cgstTotal: cgstTotal.toString(),
    sgstTotal: sgstTotal.toString(),
    igstTotal: igstTotal.toString(),
    totalTax: totalTax.toString(),
    roundOff: roundOff.toString(),
    grandTotal: grandTotal.toString(),
    lineTotals,
  };
}

function randomInvoice(rand: () => number, round: boolean): { input: BuildInvoiceInput; ref: ReturnType<typeof referenceTotals> } {
  const nLines = 1 + Math.floor(rand() * 6);
  const lines: InvoiceLineInput[] = [];
  for (let i = 0; i < nLines; i++) {
    const hsn = HSNS[Math.floor(rand() * HSNS.length)]!;
    const rate = RATES[Math.floor(rand() * RATES.length)]!;
    const qty = 1 + Math.floor(rand() * 40);
    // taxable value: 0.00–9999.99, up to two decimals.
    const taxable = Math.floor(rand() * 1_000_000) / 100;
    lines.push({ productId: `P${i}`, hsnCode: hsn, taxRatePercent: rate, taxableValue: new Money(taxable), quantity: String(qty) });
  }
  const supplier = STATES[Math.floor(rand() * STATES.length)]!;
  let customer = STATES[Math.floor(rand() * STATES.length)]!;
  if (rand() < 0.5) customer = supplier; // bias toward intra-state half the time
  const input: BuildInvoiceInput = { supplierStateCode: supplier, customerStateCode: customer, lines, roundToWholeRupee: round };
  return { input, ref: referenceTotals(input) };
}

describe('invoice reconciliation — 1,000 generated orders (exit criterion)', () => {
  for (const round of [false, true]) {
    it(`reconciles every total and line to the paisa${round ? ' (whole-rupee rounding)' : ''}`, () => {
      const rand = mulberry32(round ? 0xc0ffee : 0x1234);
      for (let i = 0; i < 1000; i++) {
        const { input, ref } = randomInvoice(rand, round);
        const inv = buildInvoice(input);
        const t = inv.totals;

        expect(t.taxableTotal).toBe(ref.taxableTotal);
        expect(t.cgstTotal).toBe(ref.cgstTotal);
        expect(t.sgstTotal).toBe(ref.sgstTotal);
        expect(t.igstTotal).toBe(ref.igstTotal);
        expect(t.totalTax).toBe(ref.totalTax);
        expect(t.roundOff).toBe(ref.roundOff);
        expect(t.grandTotal).toBe(ref.grandTotal);

        for (let j = 0; j < inv.lines.length; j++) {
          expect(inv.lines[j]!.lineTotal).toBe(ref.lineTotals[j]);
        }

        // The round-off must stay within ±0.50 by construction.
        expect(new Money(t.roundOff).value.abs().lessThanOrEqualTo(0.5)).toBe(true);
      }
    });
  }
});
