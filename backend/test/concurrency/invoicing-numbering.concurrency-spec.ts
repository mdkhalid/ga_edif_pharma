import { Prisma } from '@prisma/client';

import { requestContext } from '../../src/common/context/request-context';
import { fiscalYearFor } from '../../src/modules/invoicing/domain/invoice-numbering';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import type { InvoicingService } from '../../src/modules/invoicing/application/invoicing.service';
import { asTenantUser, createTestPrisma } from '../support/database';
import { buildInvoicingService } from '../support/services';

/**
 * Invoice issuing under contention — the half of the P7 exit criteria that only
 * exists on a real database.
 *
 *   "Invoice numbers are gapless and unique per tenant and fiscal year."
 *
 * Two invariants, and they fail for different reasons, so they are checked
 * separately:
 *
 *   1. **Distinct orders, one run of consecutive numbers.** The number comes from
 *      an atomic `UPDATE … RETURNING` on one `invoice_sequence` row. Concurrent
 *      issuers serialise on that row, so every committed invoice owns a number
 *      nobody else has and no number is skipped. This is the claim the
 *      `allocateNumber` comment makes and that no stub can verify: it is entirely
 *      a statement about what PostgreSQL does with two concurrent `UPDATE`s on one
 *      row.
 *   2. **The same order issued concurrently yields one invoice.** The service's
 *      business-level idempotency is a `findFirst` for an existing live invoice
 *      followed by an insert. Two callers that both read "no existing invoice"
 *      before either commits would each take a number and each insert — two tax
 *      documents for one order, which is the specific failure the feature exists
 *      to prevent, and exactly the shape `order-placement.concurrency-spec.ts`
 *      already guards for the cart.
 *
 * These are correctness tests, not benchmarks. Each fires a handful of concurrent
 * calls and asserts the invariant, with no timing assumption beyond "these
 * overlap" — the whole point is that correctness here comes from the lock, not
 * from luck.
 */

/** Fixed so a re-run reuses and re-cleans the same tenant. */
const TENANT_ID = 'c0000000-0000-4000-8000-0000000000c1';
const TENANT_CODE = 'INVOICE-RACE';

/** Maharashtra, so both buyers in this file are intra-state and CGST/SGST applies. */
const STATE = '27';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

describe('invoice issuing under contention', () => {
  let prisma: ExtendedPrismaClient;
  let invoicing: InvoicingService;
  let organisationId: string;
  let productId: string;
  let fiscalYear: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    invoicing = buildInvoicingService(prisma);
    fiscalYear = fiscalYearFor(new Date());

    await dropTenant();

    await prisma.tenant.create({
      data: {
        id: TENANT_ID,
        code: TENANT_CODE,
        name: 'Invoicing Concurrency Tenant',
        legalName: 'Invoicing Concurrency Pharma Pvt. Ltd.',
        stateCode: STATE,
      },
    });

    ({ organisationId, productId } = await asTenantUser(TENANT_ID, async () => {
      const organisation = await prisma.organisation.create({
        data: {
          tenantId: TENANT_ID,
          type: 'PHARMACY',
          legalName: 'Concurrency buyer',
          status: 'ACTIVE',
          stateCode: STATE,
          approvedAt: new Date(),
        },
        select: { id: true },
      });

      const product = await prisma.product.create({
        data: {
          tenantId: TENANT_ID,
          name: 'Concurrency product',
          schedule: 'OTC',
          hsnCode: '3004',
          gstRate: new Prisma.Decimal('18'),
          price: new Prisma.Decimal('100'),
        },
        select: { id: true },
      });

      return { organisationId: organisation.id, productId: product.id };
    }));
  });

  afterAll(async () => {
    if (prisma === undefined) return;

    await dropTenant();
    await prisma.$disconnect();
  });

  /**
   * Removes the spec tenant and its rows.
   *
   * `organisation.tenant` is `onDelete: Restrict`, so the tenant cannot simply be
   * cascaded away; the children go first, leaf first. `audit_log` is append-only by
   * trigger, so the one documented escape hatch is set for this transaction — which
   * also makes the teardown atomic, so a partial failure cannot leave rows behind
   * for the next run to trip over.
   */
  async function dropTenant(): Promise<void> {
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
    }, 'invoicing-race-teardown');
  }

  /** One placed order: a line for the shared product, no discount. */
  async function placedOrder(): Promise<string> {
    return asTenantUser(TENANT_ID, async () => {
      const order = await prisma.customerOrder.create({
        data: {
          tenantId: TENANT_ID,
          organisationId,
          status: 'CONFIRMED',
          subtotal: new Prisma.Decimal('100'),
          discount: new Prisma.Decimal(0),
          total: new Prisma.Decimal('100'),
          currency: 'INR',
        },
        select: { id: true },
      });

      await prisma.orderItem.create({
        data: {
          tenantId: TENANT_ID,
          orderId: order.id,
          productId,
          quantity: new Prisma.Decimal(1),
          price: new Prisma.Decimal('100'),
        },
      });

      return order.id;
    });
  }

  const issue = (orderId: string) =>
    asTenantUser(TENANT_ID, () => invoicing.issueFromOrder(TENANT_ID, ACTOR_ID, { orderId }));

  /** The sequence position, so gaplessness can be asserted as a run, not as a count. */
  const sequence = () =>
    asTenantUser(TENANT_ID, async () => {
      const row = await prisma.invoiceSequence.findFirst({
        where: { fiscalYear },
        select: { lastNumber: true },
      });
      return row?.lastNumber ?? 0;
    });

  /** The sequence number embedded in `INV/<fy>/000123`, as an integer. */
  const sequenceOf = (invoiceNumber: string): number => Number(invoiceNumber.slice(-6));

  describe('several orders invoiced at once', () => {
    it('gives every invoice a distinct number', async () => {
      const orderIds = await Promise.all(
        Array.from({ length: 6 }, async () => placedOrder()),
      );

      const results = await Promise.allSettled(orderIds.map((id) => issue(id)));
      const issued = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => (result as PromiseFulfilledResult<{ invoiceNumber: string }>).value);

      expect(issued).toHaveLength(orderIds.length);
      expect(new Set(issued.map((row) => row.invoiceNumber)).size).toBe(issued.length);
    });

    it('leaves no gap in the sequence', async () => {
      const before = await sequence();
      const orderIds = await Promise.all(
        Array.from({ length: 6 }, async () => placedOrder()),
      );

      await Promise.allSettled(orderIds.map((id) => issue(id)));

      // A skipped number is a statutory defect in India, and it is invisible to
      // a "count the invoices" assertion: this checks the run is *consecutive*, so
      // a number consumed by a rolled-back transaction or handed to two invoices
      // both fail here.
      const numbers = (await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findMany({
          where: { orderId: { in: orderIds } },
          select: { invoiceNumber: true },
        }),
      ))
        .map((row) => sequenceOf(row.invoiceNumber))
        .sort((a, b) => a - b);

      expect(numbers).toEqual(
        Array.from({ length: orderIds.length }, (_, index) => before + 1 + index),
      );
    });

    it('agrees with the counter it moved', async () => {
      const before = await sequence();
      const orderIds = await Promise.all(
        Array.from({ length: 4 }, async () => placedOrder()),
      );

      const issued = await Promise.all(orderIds.map((id) => issue(id)));

      // One increment per committed invoice. A count that drifted upwards would
      // mean a number was burned by something that did not become an invoice.
      expect(await sequence()).toBe(before + issued.length);
    });

    it('issues a complete invoice for every order — lines and totals included', async () => {
      const orderIds = await Promise.all(
        Array.from({ length: 5 }, async () => placedOrder()),
      );
      await Promise.all(orderIds.map((id) => issue(id)));

      const rows = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findMany({
          where: { orderId: { in: orderIds } },
          select: {
            orderId: true,
            total: true,
            lines: { select: { lineTotal: true } },
          },
        }),
      );

      expect(rows).toHaveLength(orderIds.length);

      for (const row of rows) {
        // A partially written invoice — header committed, lines not — is the
        // failure a header-only assertion would miss entirely.
        expect(row.lines).toHaveLength(1);
        expect(row.total.toString()).toBe(row.lines[0]?.lineTotal.toString());
        // 100.00 taxable + 9.00 CGST + 9.00 SGST.
        expect(row.total.toString()).toBe('118');
      }
    });
  });

  describe('the same order invoiced at once', () => {
    it('produces exactly one invoice', async () => {
      const orderId = await placedOrder();

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => issue(orderId)),
      );

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const rows = await asTenantUser(TENANT_ID, async () =>
        prisma.invoice.findMany({ where: { orderId }, select: { id: true, invoiceNumber: true } }),
      );

      // The invariant the whole feature exists for: one live tax document per
      // order. Two `INV/…` numbers for the same order cannot be withdrawn.
      expect(rows).toHaveLength(1);
    });

    it('gives every successful caller the same invoice', async () => {
      const orderId = await placedOrder();

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => issue(orderId)),
      );
      const returned = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => (result as PromiseFulfilledResult<{ invoiceNumber: string }>).value);

      expect(new Set(returned.map((row) => row.invoiceNumber)).size).toBe(1);
    });

    it('consumes one number, not five', async () => {
      const before = await sequence();
      const orderId = await placedOrder();

      await Promise.allSettled(Array.from({ length: 5 }, () => issue(orderId)));

      // Even if the invoice count is right, five numbers for one document would
      // put four permanent gaps in the register. This is the assertion that
      // catches a fix applied to the insert but not to the counter.
      expect(await sequence()).toBe(before + 1);
    });
  });
});