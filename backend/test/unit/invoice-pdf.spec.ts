import { renderInvoicePdf, type PdfInvoice } from '../../src/modules/invoicing/domain/invoice-pdf';

function invoice(overrides: Partial<PdfInvoice> = {}): PdfInvoice {
  return {
    invoiceNumber: 'INV/2026-27/000123',
    status: 'ISSUED',
    gstType: 'CGST_SGST',
    totals: {
      taxableTotal: '200.0000',
      cgstTotal: '18.0000',
      sgstTotal: '18.0000',
      igstTotal: '0.0000',
      totalTax: '36.0000',
      roundOff: '0.0000',
      grandTotal: '236.0000',
    },
    lines: [
      {
        description: 'Paracetamol 500mg (Strip of 10)',
        productId: 'product-1',
        hsnCode: '3004',
        taxRate: '18',
        quantity: '1',
        taxableValue: '200.0000',
        cgst: '18.0000',
        sgst: '18.0000',
        igst: '0.0000',
        lineTotal: '236.0000',
      },
    ],
    ...overrides,
  };
}

function asText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

describe('renderInvoicePdf', () => {
  it('emits a valid PDF header, xref table and trailer', () => {
    const pdf = asText(renderInvoicePdf(invoice()));

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)?.[1]);
    expect(Number.isFinite(startxref)).toBe(true);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const objectOffsets = [...pdf.matchAll(/^(\d+) 0 obj$/gm)].map((match) => ({
      number: Number(match[1]),
      offset: match.index as number,
    }));
    expect(objectOffsets.length).toBeGreaterThan(5);
    const xrefBody = pdf.slice(startxref);
    for (const { number, offset } of objectOffsets) {
      expect(xrefBody).toContain(`${String(offset).padStart(10, '0')} 00000 n`);
      expect(number).toBeGreaterThan(0);
    }
  });

  it('shows the stored number, totals and both intra-state tax components', () => {
    const pdf = asText(renderInvoicePdf(invoice()));

    expect(pdf).toContain('INV/2026-27/000123');
    expect(pdf).toContain('INR 236.0000');
    expect(pdf).toContain('CGST INR 18.0000');
    expect(pdf).toContain('SGST INR 18.0000');
    expect(pdf).not.toContain('IGST INR 18.0000');
  });

  it('escapes PDF string delimiters and replaces glyphs the standard font cannot render', () => {
    const pdf = asText(
      renderInvoicePdf(
        invoice({
          lines: [
            {
              ...(invoice().lines[0] as NonNullable<PdfInvoice['lines'][number]>),
              description: 'Cetirizine (10mg) \\ ₹ blend',
            },
          ],
        }),
      ),
    );

    expect(pdf).toContain('Cetirizine \\(10mg\\) \\\\ INR  blend');
    expect(pdf).not.toContain('₹');
  });

  it('paginates rather than dropping lines past a page', () => {
    const line = invoice().lines[0] as NonNullable<PdfInvoice['lines'][number]>;
    const lines = Array.from({ length: 60 }, (_unused, index) => ({
      ...line,
      description: `Product ${index + 1}`,
    }));
    const pdf = asText(renderInvoicePdf(invoice({ lines })));

    expect(pdf).toContain('/Count 3');
    expect(pdf).toContain('\\(continued\\)');
    expect(pdf).toContain('Product 60');
    expect(pdf).toContain('INR 236.0000');
  });
});
