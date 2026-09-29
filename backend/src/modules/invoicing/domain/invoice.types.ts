import { Money } from '../../pricing/domain/money.vo';

export type GstType = 'CGST_SGST' | 'IGST';

/** A line to invoice: net (post-discount) taxable value plus the product's HSN and GST rate. */
export interface InvoiceLineInput {
  /** Product the line refers to (for traceability back to the order). */
  productId: string;
  /** HSN code printed on the tax invoice; also the grouping key for the HSN summary. */
  hsnCode: string;
  /** GST rate as a percentage, e.g. `12` for 12% or `5` for 5%. May be fractional. */
  taxRatePercent: string;
  /** Net taxable value of the line after discounts, already paisa-rounded. */
  taxableValue: Money;
  /** Quantity for display only (string to preserve fractional units such as strips). */
  quantity: string;
  /** Optional display description (product name). */
  description?: string;
}

export interface InvoiceLine {
  productId: string;
  hsnCode: string;
  taxRatePercent: string;
  quantity: string;
  gstType: GstType;
  description?: string;
  /** Paisa-rounded, per-line. */
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  /** `taxableValue + cgst + sgst + igst`, paisa-rounded. */
  lineTotal: string;
}

/** Per-HSN aggregation for the HSN summary on a GST tax invoice. */
export interface HsnTaxSummary {
  hsnCode: string;
  taxRatePercent: string;
  gstType: GstType;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  /** Number of invoice lines aggregated into this row. */
  lineCount: number;
}

export interface InvoiceTotals {
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  totalTax: string;
  /** Residual that brings the total to a whole rupee; within ±0.50; `0` when not rounding. */
  roundOff: string;
  grandTotal: string;
}

export interface InvoiceDraft {
  gstType: GstType;
  supplierStateCode: string;
  customerStateCode: string;
  lines: InvoiceLine[];
  hsnSummary: HsnTaxSummary[];
  totals: InvoiceTotals;
}

export interface BuildInvoiceInput {
  /** The supplying tenant's state code (e.g. `MH`). Determines CGST/SGST vs IGST. */
  supplierStateCode: string;
  /** The buying organisation's state code. Same as supplier ⇒ intra-state. */
  customerStateCode: string;
  lines: InvoiceLineInput[];
  /** Round the grand total to the nearest whole rupee and record the residual as round-off. */
  roundToWholeRupee?: boolean;
}
