import { Inject, Injectable } from '@nestjs/common';

import type {
  PriceListDetail,
  PriceListLineSummary,
  PriceListPage,
  PriceListStatus,
  PriceListSummary,
} from '@medichain/shared-types';

import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { buildOffsetMeta, resolveOffset } from '../../../common/utils/pagination.util';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import type { ListPriceListsQuery } from '../api/dto/price-list.dto';

interface CountedPriceList {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly status: PriceListStatus;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly _count: { readonly lines: number; readonly customers: number };
}

function toSummary(row: CountedPriceList): PriceListSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    status: row.status,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo.toISOString(),
    lineCount: row._count.lines,
    customerCount: row._count.customers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Read model for the price-list admin viewer (P11).
 *
 * `PricingRepository` answers a different question — "what override applies to
 * these lines for this customer?" — and deliberately cannot enumerate lists.
 * This service is the query side an operator needs: which lists exist, their
 * effective windows and how many lines/customers each one has, then the full
 * contents of one list when it is opened.
 *
 * Values stay exact: Prisma `Decimal`s are serialised with `toString()`, never
 * `Number()`, because a rounded price in an admin screen becomes a wrong price
 * in the next order.
 */
@Injectable()
export class PriceListManagementService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async list(_tenantId: string, query: ListPriceListsQuery): Promise<PriceListPage> {
    const resolved = resolveOffset(query.page, query.pageSize);
    const where = {
      ...(query.status !== undefined ? { status: query.status as never } : {}),
      ...(query.search !== undefined && query.search.trim() !== ''
        ? { name: { contains: query.search.trim(), mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.priceList.findMany({
        where,
        include: { _count: { select: { lines: true, customers: true } } },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: resolved.skip,
        take: resolved.take,
      }),
      this.prisma.priceList.count({ where }),
    ]);

    return {
      data: rows.map(toSummary),
      meta: buildOffsetMeta(total, resolved),
    };
  }

  async getById(_tenantId: string, id: string): Promise<PriceListDetail> {
    const row = await this.prisma.priceList.findFirst({
      where: { id },
      include: {
        _count: { select: { lines: true, customers: true } },
        lines: {
          orderBy: [{ productId: 'asc' }, { minQty: 'asc' }],
        },
        customers: { select: { organisationId: true } },
      },
    });
    if (row === null) throw new NotFoundError('Price list not found.');

    // PriceListLine has no `product` relation in the schema — the denormalised
    // productId is intentional — so names come from one extra lookup by id set.
    const productIds = [...new Set(row.lines.map((line) => line.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    const names = new Map(products.map((product) => [product.id, product.name]));

    const lines: PriceListLineSummary[] = row.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: names.get(line.productId) ?? null,
      minQty: line.minQty,
      unitPrice: line.unitPrice.toString(),
    }));

    return {
      ...toSummary(row),
      lines,
      customerOrganisationIds: row.customers.map((customer) => customer.organisationId),
    };
  }
}
