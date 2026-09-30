import { Prisma } from '@prisma/client';

import {
  BusinessRuleViolationError,
  ForbiddenError,
} from '../../src/common/exceptions/domain.exception';
import { fiscalYearFor } from '../../src/modules/invoicing/domain/invoice-numbering';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import type { InvoicingService } from '../../src/modules/invoicing/application/invoicing.service';
import { requestContext } from '../../src/common/context/request-context';
import { asTenantUser, createTestPrisma } from '../support/database';
import { buildInvoicingService, buildOrderService } from '../support/services';

/**
 * Invoicing against a real database — the DB-backed half of the P7 exit criteria.
 *
 *   "Invoice totals reconcile to the paisa against an independently computed
 *    expected value for 1,000 generated orders."
 *
 * The 1,000-order reconcile is `test/unit/invoice-reconcile.spec.ts` and it is
 * green: the pure builder is correct. What that suite cannot reach is everything
 * this file exists for, which is the part where the arithmetic meets the database:
 *
 *   - **The write is atomic.** The invoice, its lines, the audit row and the
 *     consumed sequence number must commit together or not at all. A failure that
 *     leaves a number consumed with no invoice behind is a *gap* in the register,
 *     and the service comments claim the update runs inside the creation
 *     transaction. That claim is asserted here, per failure mode.
 *   - **The gapless counter really is gapless.** `UPDATE … RETURNING` is the
 *     whole mechanism; no stub can prove what it does under contention. That is
 *     the concurrency suite's job, and this file pins the parts that are visible
 *     from one connection.
 *   - **Fail-closed really is fail-closed.** "Fails loudly naming the missing
 *     field" is only meaningful if the alternative — issuing an invoice with a
 *     zero where a tax figure belongs — does not also happen.
 *   - **Tax data is read where it is stored.** The state codes come from two
 *     different tables (`tenant` and `organisation`), and the intra/inter-state
 *     decision is made from them at issue time. A fixture that hard-codes "MH"
 *     would pass against a service that never read either table.
 *
 * ## Why this suite has its own tenant
 *
 * The invoice number is allocated from `invoice_sequence`, keyed on
 * `(tenant_id, fiscal_year)`. On the seeded tenant the counter has already been
 * advanced by other runs and by whatever a developer did locally, so "the third
 * invoice of this test is numbered 3" is not an assertion that can be made. A
 * dedicated tenant starts the counter at zero, which is what makes the numbering
 * assertions below exact rather than relative.
 *
 * It is torn down in `afterAll`, including its audit rows — `audit_log` has
 * `BEFORE DELETE` triggers that raise, so the teardown sets the documented
 * `medichain.allow_audit_mutation` escape hatch for one transaction rather than
 * leaving a tenant behind on every run.
 */

/** Fixed so a re-run reuses (and re-cleans) the same tenant rather than piling up. */
const TENANT_ID = 'c0000000-0000-4000-8000-0000000000c0';
const TENANT_CODE = 'INVOICE-SPEC';

/** Maharashtra and Karnataka. The two differ, so the GST split differs. */
const SUPPLIER_STATE = '27';
const INTRA_STATE = '27';
const INTER_STATE = '29';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

/** 18% is the standard GST rate on medicines, so it is the realistic one to test. */
const GST_RATE = new Prisma.Decimal('18');

describe('tax invoicing (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let invoicing: InvoicingService;
  let fiscalYear: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    invoicing = buildInvoicingService(prisma);
    fiscalYear = fiscalYearFor(new Date());

    await dropTenant();
    await createTenant();
  });

  afterAll(async () => {
    if (prisma === undefined) return;

    await dropTenant();
    await prisma.$disconnect();
  });

  /**
   * Removes the spec tenant and everything hanging off it.
   *
   * `tenant` cannot simply be deleted: `organisation.tenant` and `invoice.organisation`
   * are `onDelete: Restrict`, so Postgres refuses the cascade and a re-run would
   * start on top of the previous run's rows. The children are therefore removed
   * explicitly, leaf first. `audit_log` is append-only by trigger, so the one
   * documented escape hatch is set for the duration of this transaction — which
   * also means the whole teardown is atomic: a partial teardown that failed
   * halfway would leave rows the next run trips over.
   */
  async function dropTenant(): Promise<void> {
    // Unscoped on purpose: this is a fixture teardown, not a request, and the
    // scoping extension refuses tenant-scoped models with no context rather than
    // guessing. The `where` clauses are written out per table instead.
    await requestContext.runUnscoped(async () => {
      await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL medichain.allow_audit_mutation = 'on'`);
      await tx.invoiceLine.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.invoice.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.invoiceSequence.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.orderItem.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.orderStatusHistory.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.customerOrder.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.cartItem.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.cart.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.warehouseStock.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.product.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.organisation.deleteMany({ where: { tenantId: TENANT_ID } });
      await tx.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
        await tx.tenant.deleteMany({ where: { id: TENANT_ID } });
      });
    }, 'invoicing-spec-teardown');
  }

  /** `tenant` is a global model, so this runs without a request context. */
  async function createTenant(): Promise<void> {
    await prisma.tenant.create({
      data: {
        id: TENANT_ID,
        code: TENANT_CODE,
        name: 'Invoicing Spec Tenant',
        legalName: 'Invoicing Spec Pharma Pvt. Ltd.',
        gstin: '27SPEC00000A1Z5',
        stateCode: SUPPLIER_STATE,
      },
    });
  }

  // ── fixtures ──────────────────────────────────────────────────────────────

  /** A buying organisation, in one of the two states. */
  async function buyer(stateCode: string | null, label: string): Promise<string> {
    return asTenantUser(TENANT_ID, async () => {
      const org = await prisma.organisation.create({
        data: {
          tenantId: TENANT_ID,
          type: 'PHARMACY',
          legalName: `Invoice spec buyer ${label}`,
          status: 'ACTIVE',
          stateCode,
          approvedAt: new Date(),
        },
        select: { id: true },
      });
      return org.id;
    });
  }

  /**
   * A product, with or without the tax data an invoice legally requires.
   *
   * `hsnCode: null` is a reachable state in production — a catalogue import that
   * has not been given its HSN yet — so it is constructed here rather than assumed
   * away. `gstRate` has no such state: the column is `NOT NULL DEFAULT 0`, so a
   * zero rate is expressed as `0` and is indistinguishable from "not set". That is
   * a real gap in the data model, not something this suite should paper over: a
   * zero-rated line and a line whose rate was never entered produce the same
   * invoice, and 0% is a legitimate GST rate. It is recorded in the Phase 3 plan
   * rather than tested around.
   */
  async function product(options: {
    price: string;
    gstRate?: Prisma.Decimal;
    hsnCode?: string | null;
    label: string;
  }): Promise<string> {
    return asTenantUser(TENANT_ID, async () => {
      const row = await prisma.product.create({
        data: {
          tenantId: TENANT_ID,
          name: `Invoice spec ${options.label}`,
          schedule: 'OTC',
          price: new Prisma.Decimal(options.price),
          ...(options.hsnCode === undefined ? { hsnCode: '3004' } : { hsnCode: options.hsnCode }),
          ...(options.gstRate === undefined ? { gstRate: GST_RATE } : { gstRate: options.gstRate }),
        },
        select: { id: true },
      });
      return row.id;
    });
  }

  interface OrderLine {
    productId: string;
    quantity?: string;
    price?: string;
  }

  /**
   * An order and its lines, written directly.
   *
   * `OrderService.place` is used for the placed-order case below, because there the
   * invoice must agree with what the commerce path actually produced. Here the rows
   * are written directly for one reason: `place` hard-codes `discount: 0`, and the
   * order-level discount is one of the things an invoice has to get right. Every
   * other field the invoicing service reads — status, `organisationId`, currency,
   * the lines' price and quantity snapshots — is set exactly as `place` sets it.
   */
  async function order(
    organisationId: string,
    lines: OrderLine[],
    options: { discount?: string; status?: string } = {},
  ): Promise<string> {
    return asTenantUser(TENANT_ID, async () => {
      // The line price is a *snapshot* taken when the order was placed, so it
      // comes from the product unless a test deliberately sets a different one.
      const priced = await Promise.all(
        lines.map(async (line) => {
          if (line.price !== undefined) return { ...line, price: line.price };
          const product = await prisma.product.findFirstOrThrow({
            where: { id: line.productId },
            select: { price: true },
          });
          return { ...line, price: product.price.toString() };
        }),
      );

      const subtotal = priced.reduce(
        (sum, line) => sum.plus(new Prisma.Decimal(line.price).mul(line.quantity ?? '1')),
        new Prisma.Decimal(0),
      );
      const discount = new Prisma.Decimal(options.discount ?? '0');

      const created = await prisma.customerOrder.create({
        data: {
          tenantId: TENANT_ID,
          organisationId,
          status: options.status ?? 'PLACED',
          subtotal,
          discount,
          total: subtotal.minus(discount),
          currency: 'INR',
        },
        select: { id: true },
      });

      for (const line of priced) {
        await prisma.orderItem.create({
          data: {
            tenantId: TENANT_ID,
            orderId: created.id,
            productId: line.productId,
            quantity: new Prisma.Decimal(line.quantity ?? '1'),
            price: new Prisma.Decimal(line.price),
          },
        });
      }

      return created.id;
    });
  }

  /**
   * An order placed through the real commerce path, cart and stock reservation
   * included, so at least one invoice is built from a row nobody hand-wrote.
   */
  async function placedOrder(organisationId: string, productId: string): Promise<string> {
    const orders = buildOrderService(prisma);

    await asTenantUser(TENANT_ID, async () => {
      await prisma.warehouseStock.create({
        data: {
          tenantId: TENANT_ID,
          productId,
          warehouseId: `WH-INV-${productId.slice(0, 8)}`,
          quantity: new Prisma.Decimal(50),
          reserved: new Prisma.Decimal(0),
        },
      });

      const cart = await prisma.cart.create({
        data: {
          tenantId: TENANT_ID,
          organisationId,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        select: { id: true },
      });

      await prisma.cartItem.create({
        data: {
          tenantId: TENANT_ID,
          cartId: cart.id,
          productId,
          quantity: new Prisma.Decimal(2),
          price: new Prisma.Decimal('100'),
        },
      });
    });

    const placed = await asTenantUser(TENANT_ID, () =>
      orders.place(TENANT_ID, organisationId, ACTOR_ID, {}),
    );
    return placed.id;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  const invoicesFor = (orderId: string) =>
    asTenantUser(TENANT_ID, async () =>
      prisma.invoice.findMany({
        where: { orderId },
        select: { id: true, invoiceNumber: true, total: true, status: true },
      }),
    );

  const linesFor = (invoiceId: string) =>
    asTenantUser(TENANT_ID, async () =>
      prisma.invoiceLine.findMany({
        where: { invoiceId },
        select: {
          productId: true,
          hsnCode: true,
          taxRate: true,
          quantity: true,
          taxableValue: true,
          cgst: true,
          sgst: true,
          igst: true,
          lineTotal: true,
          description: true,
        },
      }),
    );

  const auditFor = (entityId: string) =>
    asTenantUser(TENANT_ID, async () =>
      prisma.auditLog.findMany({
        where: { entityId },
        select: { action: true, actorId: true, metadata: true },
      }),
    );

  /**
   * A stored `Decimal(18,4)` as the API returns it: two places, always.
   *
   * Asserting on `Decimal.toString()` would compare `"236"` with `"236.0000"` and
   * make the tests a hostage to `decimal.js`'s trailing-zero behaviour rather than
   * to the money. Every assertion below is about the value, so it is normalised
   * once here.
   */
  const amount = (value: Prisma.Decimal): string => value.toFixed(2);

  /** The counter this tenant has consumed for the current fiscal year. */
  const sequenceLastNumber = () =>
    asTenantUser(TENANT_ID, async () => {
      const row = await prisma.invoiceSequence.findFirst({
        where: { fiscalYear },
        select: { lastNumber: true },
      });
      return row?.lastNumber ?? 0;
    });

  const issue = (orderId: string, roundToWholeRupee?: boolean) =>
    asTenantUser(TENANT_ID, () =>
      invoicing.issueFromOrder(
        TENANT_ID,
        ACTOR_ID,
        roundToWholeRupee === undefined ? { orderId } : { orderId, roundToWholeRupee },
      ),
    );

  // ── tests ────────────────────────────────────────────────────────────────

  describe('issuing against a real order', () => {
    it('splits GST per line for an intra-state buyer and reconciles to the paisa', async () => {
      const org = await buyer(INTRA_STATE, 'intra');
      const productId = await product({ price: '100', label: 'intra 100' });
      const orderId = await order(org, [{ productId, quantity: '2' }]);

      const issued = await issue(orderId);
      const invoice = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findFirstOrThrow({ where: { id: issued.id } }),
      );

      expect(invoice.gstType).toBe('CGST_SGST');
      expect(invoice.supplierStateCode).toBe(SUPPLIER_STATE);
      expect(invoice.customerStateCode).toBe(INTRA_STATE);

      // 2 × 100.00 taxable, 18% split into two 9% halves.
      expect(amount(invoice.taxableAmount)).toBe('200.00');
      expect(amount(invoice.cgst)).toBe('18.00');
      expect(amount(invoice.sgst)).toBe('18.00');
      expect(amount(invoice.igst)).toBe('0.00');
      expect(amount(invoice.totalTax)).toBe('36.00');
      expect(amount(invoice.roundOff)).toBe('0.00');
      expect(amount(invoice.total)).toBe('236.00');

      // The three are related by construction, not by coincidence of these inputs.
      expect(
        amount(invoice.taxableAmount.plus(invoice.totalTax).plus(invoice.roundOff)),
      ).toBe(amount(invoice.total));
    });

    it('charges IGST alone to a buyer in another state', async () => {
      const org = await buyer(INTER_STATE, 'inter');
      const productId = await product({ price: '100', label: 'inter 100' });
      const orderId = await order(org, [{ productId, quantity: '2' }]);

      const issued = await issue(orderId);
      const invoice = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findFirstOrThrow({ where: { id: issued.id } }),
      );

      expect(invoice.gstType).toBe('IGST');
      expect(amount(invoice.cgst)).toBe('0.00');
      expect(amount(invoice.sgst)).toBe('0.00');
      expect(amount(invoice.igst)).toBe('36.00');
      // Same money as the intra-state invoice, different split.
      expect(amount(invoice.total)).toBe('236.00');
    });

    it('persists one line per order item, with the tax data snapshotted', async () => {
      const org = await buyer(INTRA_STATE, 'lines');
      const first = await product({ price: '100', label: 'line a' });
      const second = await product({ price: '250.50', label: 'line b', gstRate: new Prisma.Decimal('5') });
      const orderId = await order(org, [
        { productId: first, quantity: '3' },
        { productId: second, quantity: '1' },
      ]);

      const issued = await issue(orderId);
      const lines = await linesFor(issued.id);

      expect(lines).toHaveLength(2);

      const byProduct = new Map(lines.map((line) => [line.productId, line]));
      const lineA = byProduct.get(first);
      const lineB = byProduct.get(second);

      expect(amount(lineA!.taxableValue)).toBe('300.00');
      expect(amount(lineA!.cgst)).toBe('27.00');
      expect(amount(lineA!.sgst)).toBe('27.00');
      expect(amount(lineA!.lineTotal)).toBe('354.00');
      expect(lineA?.hsnCode).toBe('3004');
      expect(lineA?.taxRate.toFixed(2)).toBe('18.00');

      // A different rate on the same HSN, which is what forces the builder to
      // group by (hsn, rate) rather than by HSN alone.
      expect(amount(lineB!.taxableValue)).toBe('250.50');
      expect(amount(lineB!.cgst)).toBe('6.26');
      expect(amount(lineB!.sgst)).toBe('6.26');
      expect(lineB?.taxRate.toFixed(2)).toBe('5.00');
      expect(amount(lineB!.lineTotal)).toBe('263.02');

      // The lines sum to the header, to the paisa.
      const header = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findFirstOrThrow({
          where: { id: issued.id },
          select: { taxableAmount: true, roundOff: true, total: true },
        }),
      );

      // The lines carry the real per-line tax and sum to 617.02; the header total
      // is 617.00 because whole-rupee rounding moved 0.02 into `roundOff`, which
      // is recorded as -0.02. So `total − roundOff` is what must reconcile to the
      // lines — the reverse sign would make the assertion pass for a header whose
      // round-off column was wrong in the opposite direction, and would fail on
      // the correct one.
      const lineTaxables = lines.reduce(
        (sum, line) => sum.plus(line.taxableValue),
        new Prisma.Decimal(0),
      );
      const lineTotals = lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));

      expect(amount(header.taxableAmount)).toBe(lineTaxables.toFixed(2));
      expect(amount(header.total.minus(header.roundOff))).toBe(lineTotals.toFixed(2));
      expect(amount(header.roundOff)).not.toBe('0.00');
    });

    it('taxes the discounted value, not the pre-discount one', async () => {
      const org = await buyer(INTRA_STATE, 'discount');
      const productId = await product({ price: '100', label: 'discounted' });
      // 2 × 100 with ₹20 off: the invoice must show 90.00 of taxable value each,
      // and tax on 90.00. Taxing 100.00 would collect ₹1.80 the buyer never owes.
      const orderId = await order(org, [{ productId, quantity: '2' }], { discount: '20' });

      const issued = await issue(orderId);
      const invoice = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findFirstOrThrow({ where: { id: issued.id } }),
      );

      expect(amount(invoice.taxableAmount)).toBe('180.00');
      expect(amount(invoice.cgst)).toBe('16.20');
      expect(amount(invoice.sgst)).toBe('16.20');
      // 180 + 32.40 = 212.40, and whole-rupee rounding is on by default, so the
      // printed total is 212.00 with the 0.40 recorded as round-off rather than
      // silently dropped.
      expect(amount(invoice.totalTax)).toBe('32.40');
      expect(amount(invoice.roundOff)).toBe('-0.40');
      expect(amount(invoice.total)).toBe('212.00');
    });

    it('rounds to a whole rupee and records the residual as round-off', async () => {
      const org = await buyer(INTRA_STATE, 'roundoff');
      const productId = await product({ price: '99.99', label: 'odd' });
      const orderId = await order(org, [{ productId, quantity: '1' }]);

      const issued = await issue(orderId);
      const invoice = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findFirstOrThrow({ where: { id: issued.id } }),
      );

      // 99.99 at 18% is two 9% halves of 8.9991, each rounded up to 9.00, so the
      // raw total is 117.99 exactly and round-off is zero. The value that matters
      // is the invariant: the printed total is a whole rupee, the round-off is
      // within ±0.50, and nothing is lost between the three.
      expect(invoice.roundOff.toNumber()).toBeGreaterThanOrEqual(-0.5);
      expect(invoice.roundOff.toNumber()).toBeLessThanOrEqual(0.5);
      expect(invoice.total.toNumber()).toBe(Math.round(invoice.total.toNumber()));
      expect(
        amount(invoice.taxableAmount.plus(invoice.totalTax).plus(invoice.roundOff)),
      ).toBe(amount(invoice.total));
    });

    it('keeps the exact total when whole-rupee rounding is declined', async () => {
      const org = await buyer(INTRA_STATE, 'noround');
      const productId = await product({ price: '99.99', label: 'odd unrounded' });
      const orderId = await order(org, [{ productId, quantity: '1' }]);

      const issued = await issue(orderId, false);
      const invoice = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findFirstOrThrow({ where: { id: issued.id } }),
      );

      // 99.99 + 18.00 of tax = 117.99 exactly, and with rounding declined that is what
      // the invoice says: a fraction of a rupee is legal, it just needs to be the
      // fraction the arithmetic produced rather than one rounding invented.
      expect(amount(invoice.roundOff)).toBe('0.00');
      expect(amount(invoice.totalTax)).toBe('18.00');
      expect(amount(invoice.total)).toBe('117.99');
    });

    it('invoices an order placed through the commerce path, agreeing with it', async () => {
      const org = await buyer(INTRA_STATE, 'placed');
      const productId = await product({ price: '100', label: 'placed' });
      const orderId = await placedOrder(org, productId);

      const issued = await issue(orderId);
      const [invoice, source] = await asTenantUser(TENANT_ID, async () =>
        Promise.all([
          prisma.invoice.findFirstOrThrow({ where: { id: issued.id } }),
          prisma.customerOrder.findFirstOrThrow({ where: { id: orderId } }),
        ]),
      );

      // 2 × 100.00 placed with no discount: taxable matches the order's own total,
      // which is the property a pricing dispute turns on.
      expect(amount(invoice.taxableAmount)).toBe(amount(source.total));
      expect(amount(invoice.total)).toBe('236.00');
    });

    it('writes an audit row naming the invoice, in the same transaction', async () => {
      const org = await buyer(INTRA_STATE, 'audit');
      const productId = await product({ price: '100', label: 'audited' });
      const orderId = await order(org, [{ productId }]);

      const issued = await issue(orderId);
      const rows = await auditFor(issued.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('invoice.issued');
      expect(rows[0]?.actorId).toBe(ACTOR_ID);
      expect(rows[0]?.metadata).toMatchObject({
        invoiceNumber: issued.invoiceNumber,
        orderId,
      });
    });
  });

  describe('the number', () => {
    it('is gapless and in the current fiscal year, and consumes exactly one', async () => {
      const before = await sequenceLastNumber();

      const org = await buyer(INTRA_STATE, 'numbering');
      const productId = await product({ price: '100', label: 'numbered' });
      const orderId = await order(org, [{ productId }]);

      const issued = await issue(orderId);

      expect(issued.invoiceNumber).toBe(
        `INV/${fiscalYear}/${String(before + 1).padStart(6, '0')}`,
      );
      expect(await sequenceLastNumber()).toBe(before + 1);
    });

    it('hands out consecutive numbers to consecutive invoices', async () => {
      const before = await sequenceLastNumber();
      const org = await buyer(INTRA_STATE, 'sequence');
      const productId = await product({ price: '100', label: 'sequenced' });

      const numbers: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const orderId = await order(org, [{ productId }]);
        numbers.push((await issue(orderId)).invoiceNumber);
      }

      expect(numbers).toEqual([
        `INV/${fiscalYear}/${String(before + 1).padStart(6, '0')}`,
        `INV/${fiscalYear}/${String(before + 2).padStart(6, '0')}`,
        `INV/${fiscalYear}/${String(before + 3).padStart(6, '0')}`,
      ]);
      expect(await sequenceLastNumber()).toBe(before + 3);
    });

    it('consumes no number when the issue fails', async () => {
      const before = await sequenceLastNumber();

      // The throw happens after the sequence row exists for some tenants and
      // before the number is taken; either way the counter must not move, because
      // a number with no invoice behind it is a gap in the register.
      const org = await buyer(INTRA_STATE, 'failed numbering');
      const productId = await product({
        price: '100',
        label: 'no hsn',
        hsnCode: null,
      });
      const orderId = await order(org, [{ productId }]);

      await expect(issue(orderId)).rejects.toBeInstanceOf(BusinessRuleViolationError);

      expect(await sequenceLastNumber()).toBe(before);
      expect(await invoicesFor(orderId)).toEqual([]);
    });
  });

  describe('issuing the same order twice', () => {
    it('returns the same invoice rather than a second tax document', async () => {
      const org = await buyer(INTRA_STATE, 'idempotent');
      const productId = await product({ price: '100', label: 'idempotent' });
      const orderId = await order(org, [{ productId }]);

      const first = await issue(orderId);
      const before = await sequenceLastNumber();
      const second = await issue(orderId);

      expect(second).toEqual(first);

      const rows = await invoicesFor(orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(first.id);
      // And it did not consume a second number — the replay is free.
      expect(await sequenceLastNumber()).toBe(before);

      // One audit row, not two: the second call did not issue anything.
      expect(await auditFor(first.id)).toHaveLength(1);
    });

    it('issues a fresh invoice once the first has been cancelled', async () => {
      const org = await buyer(INTRA_STATE, 'after cancel');
      const productId = await product({ price: '100', label: 'after cancel' });
      const orderId = await order(org, [{ productId }]);

      const first = await issue(orderId);
      await asTenantUser(TENANT_ID, () =>
        invoicing.cancel(TENANT_ID, first.id, ACTOR_ID, { reason: 'Billed to the wrong GSTIN.' }),
      );

      const second = await issue(orderId);

      // A new number, because the cancelled one is no longer a live document.
      // The old number is not reused: it was printed on a document.
      expect(second.invoiceNumber).not.toBe(first.invoiceNumber);
      expect(second.id).not.toBe(first.id);

      const rows = await invoicesFor(orderId);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.status === 'ISSUED')).toHaveLength(1);
    });
  });

  describe('fail-closed', () => {
    it('refuses to issue when a product has no HSN code, and writes nothing', async () => {
      const org = await buyer(INTRA_STATE, 'no hsn');
      const productId = await product({ price: '100', label: 'hsn missing', hsnCode: null });
      const orderId = await order(org, [{ productId }]);

      await expect(issue(orderId)).rejects.toThrow(/HSN code/);
      expect(await invoicesFor(orderId)).toEqual([]);
    });

    it('refuses to issue when the buyer has no state code', async () => {
      const org = await buyer(null, 'no state');
      const productId = await product({ price: '100', label: 'buyer state missing' });
      const orderId = await order(org, [{ productId }]);

      await expect(issue(orderId)).rejects.toThrow(/state code/);
      expect(await invoicesFor(orderId)).toEqual([]);
    });

    it('refuses to issue when the supplying tenant has no state code', async () => {
      const org = await buyer(INTRA_STATE, 'tenant state');
      const productId = await product({ price: '100', label: 'tenant state missing' });
      const orderId = await order(org, [{ productId }]);

      // The intra/inter-state decision is made from this value, so with it absent
      // the service cannot know which tax to charge — it must not guess.
      await asTenantUser(TENANT_ID, async () => {
        await prisma.tenant.update({ where: { id: TENANT_ID }, data: { stateCode: null } });
      });
      try {
        await expect(issue(orderId)).rejects.toThrow(/state code/);
        expect(await invoicesFor(orderId)).toEqual([]);
      } finally {
        await asTenantUser(TENANT_ID, async () => {
          await prisma.tenant.update({
            where: { id: TENANT_ID },
            data: { stateCode: SUPPLIER_STATE },
          });
        });
      }
    });

    it('refuses a cancelled order', async () => {
      const org = await buyer(INTRA_STATE, 'cancelled order');
      const productId = await product({ price: '100', label: 'cancelled order' });
      const orderId = await order(org, [{ productId }], { status: 'CANCELLED' });

      await expect(issue(orderId)).rejects.toThrow(/cancelled order cannot be invoiced/);
    });

    it('refuses an order with no lines', async () => {
      const org = await buyer(INTRA_STATE, 'empty');
      const orderId = await order(org, []);

      await expect(issue(orderId)).rejects.toThrow(/no lines cannot be invoiced/);
    });

    it('refuses an order that does not exist', async () => {
      await expect(
        issue('00000000-0000-4000-8000-0000000000ff'),
      ).rejects.toThrow(/Order not found/);
    });
  });

  describe('cancelling', () => {
    it('marks the invoice cancelled and records who and why', async () => {
      const org = await buyer(INTRA_STATE, 'cancel');
      const productId = await product({ price: '100', label: 'cancelled' });
      const orderId = await order(org, [{ productId }]);
      const issued = await issue(orderId);

      await asTenantUser(TENANT_ID, () =>
        invoicing.cancel(TENANT_ID, issued.id, ACTOR_ID, { reason: 'Duplicate order.' }),
      );

      const invoice = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findFirstOrThrow({ where: { id: issued.id } }),
      );

      expect(invoice.status).toBe('CANCELLED');
      expect(invoice.cancelReason).toBe('Duplicate order.');
      expect(invoice.cancelledAt).not.toBeNull();

      const rows = await auditFor(issued.id);
      expect(rows.map((row) => row.action).sort()).toEqual([
        'invoice.cancelled',
        'invoice.issued',
      ]);
    });

    it('refuses to cancel an already cancelled invoice', async () => {
      const org = await buyer(INTRA_STATE, 'double cancel');
      const productId = await product({ price: '100', label: 'double cancel' });
      const orderId = await order(org, [{ productId }]);
      const issued = await issue(orderId);

      await asTenantUser(TENANT_ID, () => invoicing.cancel(TENANT_ID, issued.id, ACTOR_ID, {}));
      await expect(
        asTenantUser(TENANT_ID, () => invoicing.cancel(TENANT_ID, issued.id, ACTOR_ID, {})),
      ).rejects.toBeInstanceOf(BusinessRuleViolationError);
    });

    it('refuses to cancel an invoice that does not exist', async () => {
      await expect(
        asTenantUser(TENANT_ID, () =>
          invoicing.cancel(TENANT_ID, '00000000-0000-4000-8000-0000000000ff', ACTOR_ID, {}),
        ),
      ).rejects.toThrow(/Invoice not found/);
    });
  });

  describe('reading', () => {
    it('gives a buyer only its own invoices, and staff every invoice', async () => {
      const mine = await buyer(INTRA_STATE, 'reader mine');
      const theirs = await buyer(INTRA_STATE, 'reader theirs');
      const productId = await product({ price: '100', label: 'read scope' });

      const myOrder = await order(mine, [{ productId }]);
      const theirOrder = await order(theirs, [{ productId }]);
      const mineId = (await issue(myOrder)).id;
      await issue(theirOrder);

      const asBuyer = await asTenantUser(TENANT_ID, () =>
        invoicing.list(TENANT_ID, mine, false, {}),
      );
      const asStaff = await asTenantUser(TENANT_ID, () =>
        invoicing.list(TENANT_ID, null, true, {}),
      );

      expect(asBuyer.data.map((row) => row.id)).toContain(mineId);
      expect(asBuyer.meta.total).toBe(1);

      expect(asStaff.data.map((row) => row.id)).toContain(mineId);
      expect(asStaff.meta.total).toBeGreaterThan(1);
    });

    it("refuses a buyer another organisation's invoice", async () => {
      const owner = await buyer(INTRA_STATE, 'owner');
      const other = await buyer(INTRA_STATE, 'other');
      const productId = await product({ price: '100', label: 'read forbidden' });
      const orderId = await order(owner, [{ productId }]);
      const issued = await issue(orderId);

      const own = await asTenantUser(TENANT_ID, () =>
        invoicing.getById(TENANT_ID, issued.id, owner, false),
      );
      expect(own?.invoiceNumber).toBe(issued.invoiceNumber);

      await expect(
        asTenantUser(TENANT_ID, () => invoicing.getById(TENANT_ID, issued.id, other, false)),
      ).rejects.toBeInstanceOf(ForbiddenError);

      // Staff are not organisation-scoped.
      const staff = await asTenantUser(TENANT_ID, () =>
        invoicing.getById(TENANT_ID, issued.id, other, true),
      );
      expect(staff?.id).toBe(issued.id);
    });

    it('returns the invoice with its lines and totals in reading order', async () => {
      const org = await buyer(INTRA_STATE, 'get by id');
      const first = await product({ price: '100', label: 'get a', hsnCode: '3004' });
      const second = await product({ price: '250.50', label: 'get b', hsnCode: '2202' });
      const orderId = await order(org, [
        { productId: first, quantity: '1' },
        { productId: second, quantity: '1' },
      ]);
      const issued = await issue(orderId);

      const invoice = await asTenantUser(TENANT_ID, () =>
        invoicing.getById(TENANT_ID, issued.id, org, false),
      );

      expect(invoice?.lines).toHaveLength(2);
      // Ordered by HSN ascending, so the printed document is stable.
      expect(invoice?.lines.map((line) => line.hsnCode)).toEqual(['2202', '3004']);
      expect(invoice?.totals.taxableTotal).toBe('350.50');
      expect(invoice?.lines.map((line) => line.description)).toEqual([
        'Invoice spec get b',
        'Invoice spec get a',
      ]);
    });

    it('returns null rather than throwing for an unknown id', async () => {
      const org = await buyer(INTRA_STATE, 'missing');
      const found = await asTenantUser(TENANT_ID, () =>
        invoicing.getById(TENANT_ID, '00000000-0000-4000-8000-0000000000ff', org, true),
      );

      expect(found).toBeNull();
    });
  });
});