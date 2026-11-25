/**
 * Dependency-free PDF rendering for a stored tax invoice.
 *
 * The invoice is already issued and reconciled by the time this runs; this
 * module only presents that data. A PDF here is a fixed set of text objects and
 * rules on A4 pages using the two standard Helvetica fonts, so no font file,
 * template engine or headless browser is needed — which is why it could be
 * shipped without adding a dependency to the money path.
 *
 * Money stays in the decimal strings the service produced. No arithmetic is
 * done here: re-computing a total for display is how a printable copy drifts
 * away from the invoice it claims to represent.
 */

export interface PdfInvoice {
  readonly invoiceNumber: string;
  readonly status: string;
  readonly gstType: string;
  readonly totals: {
    readonly taxableTotal: string;
    readonly cgstTotal: string;
    readonly sgstTotal: string;
    readonly igstTotal: string;
    readonly totalTax: string;
    readonly roundOff: string;
    readonly grandTotal: string;
  };
  readonly lines: readonly {
    readonly description: string | null;
    readonly productId: string;
    readonly hsnCode: string;
    readonly taxRate: string;
    readonly quantity: string;
    readonly taxableValue: string;
    readonly cgst: string;
    readonly sgst: string;
    readonly igst: string;
    readonly lineTotal: string;
  }[];
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 42;
const RIGHT = PAGE_WIDTH - LEFT;
const LINES_PER_PAGE = 26;

/** PDF string literals may not contain an unescaped `\`, `(` or `)`. */
function escapeLiteral(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`);
}

/**
 * Standard fonts with WinAnsiEncoding still cannot render the rupee glyph, and
 * product descriptions may contain characters outside Latin-1. Replace those
 * rather than emit invalid bytes — an invoice PDF that is corrupt is worse than
 * one with a `?` in a description.
 */
function toAscii(value: string): string {
  return value
    .replace(/₹/g, 'INR ')
    .replace(/[^\x20-\x7E]/g, '?');
}

function money(value: string): string {
  return `INR ${value}`;
}

class PageBuilder {
  private readonly commands: string[] = [];

  text(value: string, x: number, y: number, bold = false, size = 9): void {
    const font = bold ? 'F2' : 'F1';
    this.commands.push(
      `BT /${font} ${size} Tf ${x} ${y} Td (${escapeLiteral(toAscii(value))}) Tj ET`,
    );
  }

  rule(y: number): void {
    this.commands.push(`0.6 w ${LEFT} ${y} m ${RIGHT} ${y} l S`);
  }

  stream(): string {
    return this.commands.join('\n');
  }
}

function columnHeader(page: PageBuilder, y: number): void {
  page.text('Item', LEFT, y, true);
  page.text('HSN', 300, y, true);
  page.text('Qty', 350, y, true);
  page.text('Taxable', 392, y, true);
  page.text('CGST/SGST', 452, y, true);
  page.text('Total', 520, y, true);
  page.rule(y - 6);
}

function writeTotals(page: PageBuilder, invoice: PdfInvoice, y: number): void {
  page.rule(y);
  page.text('Taxable value', 300, y - 18);
  page.text(money(invoice.totals.taxableTotal), 430, y - 18);
  page.text('Total tax', 300, y - 34);
  page.text(money(invoice.totals.totalTax), 430, y - 34);
  page.text('Round off', 300, y - 50);
  page.text(money(invoice.totals.roundOff), 430, y - 50);
  page.text('GRAND TOTAL', 300, y - 72, true);
  page.text(money(invoice.totals.grandTotal), 430, y - 72, true, 11);
  page.rule(y - 84);

  const breakdown =
    invoice.gstType === 'IGST'
      ? `Inter-state: IGST ${money(invoice.totals.igstTotal)}`
      : `Intra-state: CGST ${money(invoice.totals.cgstTotal)} + SGST ${money(invoice.totals.sgstTotal)}`;
  page.text(breakdown, LEFT, y - 108);
  page.text('Generated from the stored invoice; no figures are recomputed here.', LEFT, y - 130);
}

/**
 * Returns a valid single-document PDF.
 *
 * Objects are numbered after the page count is known: catalog=1, pages=2, then
 * one page and one content object per page, then the two fonts. Every xref
 * offset is computed from the assembled string, not estimated — an off-by-one
 * xref still opens in lenient viewers but fails strict parsers.
 */
export function renderInvoicePdf(invoice: PdfInvoice): Uint8Array {
  const pages: PageBuilder[] = [];
  let page = new PageBuilder();
  page.text('TAX INVOICE', LEFT, 795, true, 18);
  page.text(invoice.invoiceNumber, LEFT, 768, true, 12);
  page.text(`Status: ${invoice.status}    Tax: ${invoice.gstType}`, LEFT, 748);
  page.rule(736);
  page.text('All amounts in INR', LEFT, 722);
  columnHeader(page, 704);

  let y = 684;
  let onPage = 0;
  for (const line of invoice.lines) {
    if (onPage === LINES_PER_PAGE) {
      pages.push(page);
      page = new PageBuilder();
      page.text(`${invoice.invoiceNumber} (continued)`, LEFT, 795, true, 12);
      page.text('All amounts in INR', LEFT, 722);
      columnHeader(page, 704);
      y = 684;
      onPage = 0;
    }

    const description = line.description ?? line.productId;
    page.text(description.slice(0, 42), LEFT, y);
    page.text(line.hsnCode, 300, y);
    page.text(line.quantity, 350, y);
    page.text(line.taxableValue, 392, y);
    const tax =
      invoice.gstType === 'IGST'
        ? line.igst
        : `${line.cgst}/${line.sgst}`;
    page.text(tax, 452, y, false, 8);
    page.text(line.lineTotal, 520, y, false, 8);
    y -= 18;
    onPage += 1;
  }

  writeTotals(page, invoice, y - 10);
  pages.push(page);

  const fontRegular = 3 + pages.length * 2;
  const fontBold = fontRegular + 1;
  const kids = pages.map((_unused, index) => `${3 + index * 2} 0 R`).join(' ');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
  ];
  for (const built of pages) {
    const contentObject = objects.length + 2;
    const stream = built.stream();
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
        `/Contents ${contentObject} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
