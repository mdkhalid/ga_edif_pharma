import { Money, ZERO } from '../../pricing';
import { splitGst } from './tax';
import type {
  BuildInvoiceInput,
  GstType,
  HsnTaxSummary,
  InvoiceDraft,
  InvoiceLine,
  InvoiceTotals,
} from './invoice.types';

function keyOf(hsnCode: string, taxRatePercent: string): string {
  return `${hsnCode}|${taxRatePercent}`;
}

/**
 * Build a GST tax invoice (draft) from already-priced order lines.
 *
 * Pure and deterministic: the same inputs always yield the same invoice, which is
 * what makes "the invoice total equals the order total plus the right tax" hold by
 * construction. Tax is computed per line and summed — never computed once on the
 * grand total — so a₹0.01 rounding remainder lands on the line that produced it and
 * the HSN summary reconciles to the paisa.
 *
 * Rounding discipline (matches the Money VO and the pricing engine): tax components
 * are rounded to the paisa per line; the grand total is the sum of those rounded
 * components; optional whole-rupee rounding expresses the residual as `roundOff`,
 * which is always within ±0.50 by construction.
 */
export function buildInvoice(input: BuildInvoiceInput): InvoiceDraft {
  const intra = input.supplierStateCode.toUpperCase() === input.customerStateCode.toUpperCase();
  const gstType: GstType = intra ? 'CGST_SGST' : 'IGST';

  const lines: InvoiceLine[] = [];
  const summaryMap = new Map<string, HsnTaxSummary>();

  let taxableTotal = ZERO;
  let cgstTotal = ZERO;
  let sgstTotal = ZERO;
  let igstTotal = ZERO;

  for (const line of input.lines) {
    const split = splitGst(input.supplierStateCode, input.customerStateCode, line.taxRatePercent, line.taxableValue);

    taxableTotal = taxableTotal.plus(line.taxableValue);
    cgstTotal = cgstTotal.plus(split.cgst);
    sgstTotal = sgstTotal.plus(split.sgst);
    igstTotal = igstTotal.plus(split.igst);

    const lineTotal = line.taxableValue.plus(split.totalTax).round();
    lines.push({
      productId: line.productId,
      hsnCode: line.hsnCode,
      taxRatePercent: line.taxRatePercent,
      quantity: line.quantity,
      ...(line.description !== undefined ? { description: line.description } : {}),
      taxableValue: line.taxableValue.toString(),
      cgst: split.cgst.toString(),
      sgst: split.sgst.toString(),
      igst: split.igst.toString(),
      lineTotal: lineTotal.toString(),
      gstType: split.gstType,
    });

    const k = keyOf(line.hsnCode, line.taxRatePercent);
    const existing = summaryMap.get(k);
    if (existing) {
      summaryMap.set(k, {
        ...existing,
        taxableValue: new Money(existing.taxableValue).plus(line.taxableValue).toString(),
        cgst: new Money(existing.cgst).plus(split.cgst).toString(),
        sgst: new Money(existing.sgst).plus(split.sgst).toString(),
        igst: new Money(existing.igst).plus(split.igst).toString(),
        lineCount: existing.lineCount + 1,
      });
    } else {
      summaryMap.set(k, {
        hsnCode: line.hsnCode,
        taxRatePercent: line.taxRatePercent,
        gstType: split.gstType,
        taxableValue: line.taxableValue.toString(),
        cgst: split.cgst.toString(),
        sgst: split.sgst.toString(),
        igst: split.igst.toString(),
        lineCount: 1,
      });
    }
  }

  const totalTax = cgstTotal.plus(sgstTotal).plus(igstTotal);
  const raw = taxableTotal.plus(totalTax);

  let roundOff = ZERO;
  let grandTotal = raw.round();
  if (input.roundToWholeRupee) {
    const rounded = new Money(raw.value.toDecimalPlaces(0));
    roundOff = rounded.minus(raw.round());
    grandTotal = rounded;
  }

  const totals: InvoiceTotals = {
    taxableTotal: taxableTotal.toString(),
    cgstTotal: cgstTotal.toString(),
    sgstTotal: sgstTotal.toString(),
    igstTotal: igstTotal.toString(),
    totalTax: totalTax.toString(),
    roundOff: roundOff.toString(),
    grandTotal: grandTotal.toString(),
  };

  return {
    gstType,
    supplierStateCode: input.supplierStateCode,
    customerStateCode: input.customerStateCode,
    lines,
    hsnSummary: [...summaryMap.values()],
    totals,
  };
}
