import type { DecimalString, OffsetPaginated } from './common';

/** Lifecycle of a tax invoice. Credit notes (Phase 3) move ISSUED → CREDITED. */
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED' | 'CREDITED';

/** Intra-state (CGST+SGST) vs inter-state (IGST) taxation. */
export type GstType = 'CGST_SGST' | 'IGST';

/** An invoice as it appears in a list. */
export interface InvoiceSummary {
  readonly id: string;
  /** Gapless, e.g. `INV/2026-27/000123`. */
  readonly invoiceNumber: string;
  readonly status: InvoiceStatus;
  readonly total: DecimalString;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

/** One persisted invoice line with the tax the builder computed. */
export interface InvoiceLine {
  readonly productId: string;
  readonly description: string | null;
  readonly hsnCode: string;
  /** GST rate as a percentage, snapshotted at issue time. */
  readonly taxRate: DecimalString;
  readonly quantity: DecimalString;
  readonly taxableValue: DecimalString;
  readonly cgst: DecimalString;
  readonly sgst: DecimalString;
  readonly igst: DecimalString;
  readonly lineTotal: DecimalString;
}

/** The invoice money block. `grandTotal` always equals taxable + tax + round-off. */
export interface InvoiceTotals {
  readonly taxableTotal: DecimalString;
  readonly cgstTotal: DecimalString;
  readonly sgstTotal: DecimalString;
  readonly igstTotal: DecimalString;
  readonly totalTax: DecimalString;
  readonly roundOff: DecimalString;
  readonly grandTotal: DecimalString;
}

export interface InvoiceDetail {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly status: InvoiceStatus;
  readonly gstType: GstType;
  readonly totals: InvoiceTotals;
  readonly lines: readonly InvoiceLine[];
}

export type InvoicePage = OffsetPaginated<InvoiceSummary>;

/** Issue echoes the new invoice's identity, its gapless number and its total. */
export interface InvoiceIssueResult {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly total: DecimalString;
}
