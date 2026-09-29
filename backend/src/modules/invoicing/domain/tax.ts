import Decimal from 'decimal.js';
import { Money, ZERO } from '../../pricing/domain/money.vo';
import type { GstType } from './invoice.types';

export interface GstSplit {
  gstType: GstType;
  cgst: Money;
  sgst: Money;
  igst: Money;
  /** `cgst + sgst` intra-state, `igst` inter-state. Paisa-rounded. */
  totalTax: Money;
}

/**
 * Intra-state when the supplier and customer share a state code: the tax is split
 * CGST + SGST. Different states ⇒ a single IGST. Both halves are charged at half
 * the rate, so the customer pays the same total either way; only the split (and the
 * accounting entries it feeds) differs.
 */
export function isIntraState(supplierStateCode: string, customerStateCode: string): boolean {
  if (!supplierStateCode || !customerStateCode) {
    throw new Error('Both supplier and customer state codes are required to determine GST applicability.');
  }
  return supplierStateCode.toUpperCase() === customerStateCode.toUpperCase();
}

/**
 * Pure GST split for one taxable amount at one rate. Each component is rounded to
 * the paisa independently, so the per-line `cgst`/`sgst`/`igst` you print are
 * exactly what `buildInvoice` sums — there is no hidden rounding against the total.
 */
export function splitGst(
  supplierStateCode: string,
  customerStateCode: string,
  taxRatePercent: Decimal.Value,
  taxable: Money,
): GstSplit {
  const intra = isIntraState(supplierStateCode, customerStateCode);
  const rate = new Decimal(taxRatePercent); // percentage, e.g. 12 or 12.5

  if (intra) {
    const half = rate.div(2);
    const cgst = taxable.times(half.div(100)).round();
    const sgst = taxable.times(half.div(100)).round();
    return { gstType: 'CGST_SGST', cgst, sgst, igst: ZERO, totalTax: cgst.plus(sgst) };
  }

  const igst = taxable.times(rate.div(100)).round();
  return { gstType: 'IGST', cgst: ZERO, sgst: ZERO, igst, totalTax: igst };
}
