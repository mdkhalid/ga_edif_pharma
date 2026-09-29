/**
 * Gapless invoice numbering.
 *
 * The *format* is pure and tested; the *allocation* of the next sequence number is
 * a database concern — it must be taken under a row lock so two concurrent
 * dispatches can never reuse or skip a number (a tax-invoice numbering gap is a
 * statutory defect in India). The Prisma adapter performs that allocation; this
 * module only formats what it is given and advances a counter by one.
 */

/**
 * India fiscal year runs Apr–Mar. 2026-03-31 ⇒ `2025-26`; 2026-04-01 ⇒ `2026-27`.
 * Computed in UTC so a server in any timezone produces the same year label.
 */
export function fiscalYearFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0 = Jan … 3 = Apr
  const startsInYear = m >= 3 ? y : y - 1;
  return `${startsInYear}-${String(startsInYear + 1).slice(-2)}`;
}

/** `INV/2026-27/000123`. Sequence must be a positive integer for gapless numbering. */
export function formatInvoiceNumber(sequence: number, fiscalYear: string, prefix = 'INV'): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error('Invoice sequence must be a positive integer for gapless numbering.');
  }
  return `${prefix}/${fiscalYear}/${String(sequence).padStart(6, '0')}`;
}

/** The next gapless number is strictly the current + 1. */
export function nextGaplessSequence(current: number): number {
  if (!Number.isInteger(current) || current < 0) {
    throw new Error('Current invoice sequence must be a non-negative integer.');
  }
  return current + 1;
}
