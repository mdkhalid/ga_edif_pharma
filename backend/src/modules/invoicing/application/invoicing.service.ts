import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type InvoiceStatus } from '@prisma/client';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork, type TransactionClient } from '../../../database/unit-of-work';
import {
  buildOffsetMeta,
  resolveOffset,
} from '../../../common/utils/pagination.util';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  NotFoundError,
} from '../../../common/exceptions/domain.exception';
import { Money, paisa, ZERO } from '../../pricing';
import { buildInvoice } from '../domain/invoice.builder';
import { fiscalYearFor, formatInvoiceNumber } from '../domain/invoice-numbering';
import type { InvoiceLineInput } from '../domain/invoice.types';
import { distributeDiscount } from './discount-distribution';
import { AuditService } from '../../audit';
import type { CancelInvoiceDto, IssueInvoiceDto, ListInvoicesQuery } from '../api/dto/invoice.dto';

/**
 * Tax invoices issued against orders.
 *
 * ## One live invoice per order
 *
 * Issuing is idempotent at the business level, not just the HTTP level: when a
 * live (non-cancelled) invoice already exists for the order, re-issuing returns
 * it instead of creating a second one. A second `INV/…` number for the same
 * order would be a duplicate tax document, which is worse than a duplicate
 * order — the order can be cancelled, the invoice number cannot be un-issued.
 *
 * ## Gapless numbering
 *
 * The number comes from an atomic `UPDATE … RETURNING` on the tenant's
 * fiscal-year sequence row, inside the same transaction that creates the
 * invoice. Two concurrent issues serialise on that row: the second sees the
 * first's increment, so a number is never reused and never skipped by
 * contention. (A transaction that rolls back after taking a number leaves a
 * gap; that gap is explainable in the audit trail, which is what the statute
 * requires.)
 *
 * ## Fail-closed tax data
 *
 * An invoice with a missing HSN, state code or GST rate is an illegal document,
 * so the issue fails loudly naming the missing field rather than printing a
 * document with a zero where a tax figure belongs.
 *
 * ## Query discipline
 *
 * Only `findFirst`/`findMany`/`updateMany`/`create`/`createMany` appear below —
 * never `findUnique`/`update`/`upsert` by id. The scoping extension appends
 * `tenantId` to the filter, and Prisma rejects a non-unique `where` on the
 * singular operations.
 */
@Injectable()
export class InvoicingService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  /**
   * Issues the order's tax invoice, or returns the live one it already has.
   *
   * ## One live invoice per order, established under a lock
   *
   * `READ COMMITTED` does not make "does a live invoice exist?" followed by "insert
   * one" safe. Two concurrent issues of the same order can both read *no* existing
   * invoice before either commits, and then both insert — two `INV/…` documents for
   * one order. A duplicate tax document is worse than a duplicate order: an order
   * can be cancelled, an invoice number cannot be un-issued.
   *
   * So the order row is locked `FOR UPDATE` before the existence check, and both
   * happen inside the one transaction. Concurrent issuers for the same order
   * serialise on that row, so the second reads the invoice the first committed and
   * returns it. Locking the *order* rather than an invoice row is deliberate: on
   * the first issue there is no invoice row to lock, and the order is the resource
   * the invariant is keyed on.
   */
  async issueFromOrder(
    tenantId: string,
    actorId: string,
    dto: IssueInvoiceDto,
  ): Promise<{ id: string; invoiceNumber: string; total: string }> {
    return this.uow.transaction(async (tx) => {
      const locked = await this.uow.lockById<{ id: string }>(
        tx,
        'customer_order',
        dto.orderId,
        tenantId,
      );
      if (!locked) throw new NotFoundError('Order not found.');

      const order = await tx.customerOrder.findFirst({
        where: { id: dto.orderId },
        include: {
          orderItems: {
            include: {
              product: { select: { id: true, name: true, hsnCode: true, gstRate: true } },
            },
          },
        },
      });
      if (!order) throw new NotFoundError('Order not found.');
      if (order.status === 'CANCELLED') {
        throw new BusinessRuleViolationError('A cancelled order cannot be invoiced.');
      }
      if (order.orderItems.length === 0) {
        throw new BusinessRuleViolationError('An order with no lines cannot be invoiced.');
      }

      const existing = await tx.invoice.findFirst({
        where: { orderId: order.id, status: { not: 'CANCELLED' } },
        select: { id: true, invoiceNumber: true, total: true },
        orderBy: { invoiceDate: 'desc' },
      });
      if (existing) {
        return {
          id: existing.id,
          invoiceNumber: existing.invoiceNumber,
          // `paisa`, not `toString()`: this branch echoes the stored row while the
          // fresh-issue branch echoes the computed draft, and `Decimal.toString()`
          // drops trailing zeros. Without this the idempotent replay returned
          // "236" where the first response returned "236.00" — the same invoice,
          // two different totals, to any caller comparing the two.
          total: paisa(existing.total.toString()),
        };
      }

      const [supplier, customer] = await Promise.all([
        tx.tenant.findFirst({ where: { id: tenantId }, select: { stateCode: true } }),
        tx.organisation.findFirst({
          where: { id: order.organisationId },
          select: { stateCode: true },
        }),
      ]);
      if (!supplier?.stateCode) {
        throw new BusinessRuleViolationError(
          'The tenant has no state code configured. Set it before issuing tax invoices.',
        );
      }
      if (!customer?.stateCode) {
        throw new BusinessRuleViolationError(
          'The buying organisation has no state code. Set it before issuing tax invoices.',
        );
      }

      const rawTaxables = order.orderItems.map((item) => {
        if (!item.product.hsnCode) {
          throw new BusinessRuleViolationError(
            `Product ${item.product.name} has no HSN code. Set it before invoicing.`,
          );
        }
        return {
          productId: item.productId,
          productName: item.product.name,
          hsnCode: item.product.hsnCode,
          taxRatePercent: item.product.gstRate.toString(),
          quantity: item.quantity.toString(),
          taxable: new Money(item.price.toString()).times(item.quantity.toString()).round(),
        };
      });

      const taxables = distributeDiscount(
        rawTaxables.map((l) => l.taxable),
        new Money(order.discount.toString()),
      );

      const lines: InvoiceLineInput[] = rawTaxables.map((l, i) => ({
        productId: l.productId,
        hsnCode: l.hsnCode,
        taxRatePercent: l.taxRatePercent,
        taxableValue: taxables[i] ?? ZERO,
        quantity: l.quantity,
        description: l.productName,
      }));

      const draft = buildInvoice({
        supplierStateCode: supplier.stateCode,
        customerStateCode: customer.stateCode,
        lines,
        roundToWholeRupee: dto.roundToWholeRupee ?? true,
      });

      const invoiceDate = new Date();
      const fiscalYear = fiscalYearFor(invoiceDate);
      const sequence = await this.allocateNumber(tx, tenantId, fiscalYear);
      const invoiceNumber = formatInvoiceNumber(sequence, fiscalYear);

      const created = await tx.invoice.create({
        data: {
          tenantId,
          organisationId: order.organisationId,
          orderId: order.id,
          invoiceNumber,
          invoiceDate,
          fiscalYear,
          gstType: draft.gstType,
          supplierStateCode: supplier.stateCode,
          customerStateCode: customer.stateCode,
          taxableAmount: new Prisma.Decimal(draft.totals.taxableTotal),
          cgst: new Prisma.Decimal(draft.totals.cgstTotal),
          sgst: new Prisma.Decimal(draft.totals.sgstTotal),
          igst: new Prisma.Decimal(draft.totals.igstTotal),
          totalTax: new Prisma.Decimal(draft.totals.totalTax),
          roundOff: new Prisma.Decimal(draft.totals.roundOff),
          total: new Prisma.Decimal(draft.totals.grandTotal),
          currency: order.currency,
          status: 'ISSUED',
        },
        select: { id: true },
      });

      await tx.invoiceLine.createMany({
        data: draft.lines.map((line) => ({
          tenantId,
          invoiceId: created.id,
          productId: line.productId,
          hsnCode: line.hsnCode,
          taxRate: new Prisma.Decimal(line.taxRatePercent),
          quantity: new Prisma.Decimal(line.quantity),
          taxableValue: new Prisma.Decimal(line.taxableValue),
          cgst: new Prisma.Decimal(line.cgst),
          sgst: new Prisma.Decimal(line.sgst),
          igst: new Prisma.Decimal(line.igst),
          lineTotal: new Prisma.Decimal(line.lineTotal),
          description: line.description ?? null,
        })),
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'invoice.issued',
        entity: 'Invoice',
        entityId: created.id,
        actorId,
        metadata: {
          invoiceNumber,
          orderId: order.id,
          total: draft.totals.grandTotal,
        },
      });

      return { id: created.id, invoiceNumber, total: draft.totals.grandTotal };
    });
  }

  async getById(
    _tenantId: string,
    id: string,
    organisationId: string | null,
    staff: boolean,
  ): Promise<{
    id: string;
    invoiceNumber: string;
    status: string;
    gstType: string;
    totals: {
      taxableTotal: string;
      cgstTotal: string;
      sgstTotal: string;
      igstTotal: string;
      totalTax: string;
      roundOff: string;
      grandTotal: string;
    };
    lines: Array<{
      productId: string;
      description: string | null;
      hsnCode: string;
      taxRate: string;
      quantity: string;
      taxableValue: string;
      cgst: string;
      sgst: string;
      igst: string;
      lineTotal: string;
    }>;
  } | null> {
    // The tenant filter is injected by the scoping extension.
    const row = await this.prisma.invoice.findFirst({
      where: { id },
      include: { lines: { orderBy: { hsnCode: 'asc' } } },
    });
    if (!row) return null;
    if (!staff && organisationId !== row.organisationId) {
      throw new ForbiddenError('This invoice belongs to another organisation.');
    }

    return {
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      status: row.status,
      gstType: row.gstType,
      // Money goes through `paisa` so a stored `Decimal(18,4)` leaves as the same
      // two-place string the builder produced. Tax rate and quantity are not
      // money and keep their natural scale.
      totals: {
        taxableTotal: paisa(row.taxableAmount.toString()),
        cgstTotal: paisa(row.cgst.toString()),
        sgstTotal: paisa(row.sgst.toString()),
        igstTotal: paisa(row.igst.toString()),
        totalTax: paisa(row.totalTax.toString()),
        roundOff: paisa(row.roundOff.toString()),
        grandTotal: paisa(row.total.toString()),
      },
      lines: row.lines.map((line) => ({
        productId: line.productId,
        description: line.description,
        hsnCode: line.hsnCode,
        taxRate: line.taxRate.toString(),
        quantity: line.quantity.toString(),
        taxableValue: paisa(line.taxableValue.toString()),
        cgst: paisa(line.cgst.toString()),
        sgst: paisa(line.sgst.toString()),
        igst: paisa(line.igst.toString()),
        lineTotal: paisa(line.lineTotal.toString()),
      })),
    };
  }

  async list(
    _tenantId: string,
    organisationId: string | null,
    staff: boolean,
    query: ListInvoicesQuery,
  ): Promise<{
    data: Array<{ id: string; invoiceNumber: string; status: string; total: string; createdAt: Date }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    const resolved = resolveOffset(query.page, query.pageSize);
    // The tenant filter is injected by the scoping extension; the
    // organisation filter keeps a buyer inside their own invoices. The status
    // string is narrowed to the Prisma enum union — an unknown status is
    // ignored rather than rejected, matching the orders list behaviour.
    const where: Prisma.InvoiceWhereInput = {
      ...(isInvoiceStatus(query.status) ? { status: query.status } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(!staff && organisationId ? { organisationId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        select: { id: true, invoiceNumber: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: resolved.skip,
        take: resolved.take,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        status: row.status,
        total: paisa(row.total.toString()),
        createdAt: row.createdAt,
      })),
      meta: buildOffsetMeta(total, resolved),
    };
  }

  async cancel(tenantId: string, id: string, actorId: string, dto: CancelInvoiceDto): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const locked = await this.uow.lockById<{ id: string; status: string }>(
        tx,
        'invoice',
        id,
        tenantId,
      );
      if (!locked) throw new NotFoundError('Invoice not found.');
      if (locked.status !== 'ISSUED') {
        throw new BusinessRuleViolationError('Only an issued invoice can be cancelled.');
      }

      await tx.invoice.updateMany({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: dto.reason ?? null,
        },
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'invoice.cancelled',
        entity: 'Invoice',
        entityId: id,
        actorId,
        metadata: { reason: dto.reason ?? null },
      });
    });
  }

  /**
   * Takes the next gapless number for this tenant and fiscal year.
   *
   * `INSERT … ON CONFLICT DO NOTHING` guarantees the counter row exists even
   * for the first invoice of a year; the atomic `UPDATE … RETURNING` then hands
   * out exactly one number per call. Concurrent issuers serialise on that row,
   * so a number is never handed out twice — and because the update runs inside
   * the invoice-creation transaction, a committed invoice always owns its
   * number. Raw SQL bypasses the scoping extension by design, so the tenant
   * filter is written out explicitly, like every other raw query here.
   */
  private async allocateNumber(
    tx: TransactionClient,
    tenantId: string,
    fiscalYear: string,
  ): Promise<number> {
    await tx.$executeRawUnsafe(
      `INSERT INTO "invoice_sequence" ("id", "tenant_id", "fiscal_year", "last_number")
       VALUES (gen_random_uuid(), $1::uuid, $2, 0)
       ON CONFLICT ("tenant_id", "fiscal_year") DO NOTHING`,
      tenantId,
      fiscalYear,
    );
    const rows = await tx.$queryRawUnsafe<{ last_number: number }[]>(
      `UPDATE "invoice_sequence" SET "last_number" = "last_number" + 1
       WHERE "tenant_id" = $1::uuid AND "fiscal_year" = $2
       RETURNING "last_number"`,
      tenantId,
      fiscalYear,
    );
    const next = rows[0]?.last_number;
    if (next === undefined || !Number.isInteger(next) || next <= 0) {
      throw new Error('Invoice sequence allocation returned no usable number.');
    }
    return next;
  }
}

/**
 * Narrows a free-text status filter to the invoice status enum. Unknown values
 * are ignored (no filter) rather than erroring, so a typo degrades to an
 * unfiltered list instead of a 500.
 */
function isInvoiceStatus(value: string | undefined): value is InvoiceStatus {
  return value === 'DRAFT' || value === 'ISSUED' || value === 'CANCELLED' || value === 'CREDITED';
}