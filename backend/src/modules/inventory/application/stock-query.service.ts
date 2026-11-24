import { Inject, Injectable } from '@nestjs/common';

import type { StockPage, StockSummary } from '@medichain/shared-types';

import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { buildOffsetMeta, resolveOffset } from '../../../common/utils/pagination.util';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import type { ListStockQuery } from '../api/dto/stock.dto';

/**
 * Read model for warehouse stock (P11).
 *
 * Order reservation uses row-locked reads of the same table; this service only
 * reports levels and never mutates them, so an operator looking at stock cannot
 * accidentally change what is available to sell.
 *
 * `available` is computed with Prisma's decimal arithmetic, not JS subtraction:
 * quantities are `Decimal(18,4)`, and a float difference could report stock that
 * is not really there.
 */
@Injectable()
export class StockQueryService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async list(_tenantId: string, query: ListStockQuery): Promise<StockPage> {
    const resolved = resolveOffset(query.page, query.pageSize);
    const where = {
      ...(query.productId !== undefined ? { productId: query.productId } : {}),
      ...(query.warehouseId !== undefined && query.warehouseId.trim() !== ''
        ? { warehouseId: query.warehouseId.trim() }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.warehouseStock.findMany({
        where,
        include: { product: { select: { name: true } } },
        orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }],
        skip: resolved.skip,
        take: resolved.take,
      }),
      this.prisma.warehouseStock.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        productId: row.productId,
        productName: row.product.name,
        warehouseId: row.warehouseId,
        batchId: row.batchId,
        expiryDate: row.expiryDate?.toISOString() ?? null,
        quantity: row.quantity.toString(),
        reserved: row.reserved.toString(),
        available: row.quantity.minus(row.reserved).toString(),
      })),
      meta: buildOffsetMeta(total, resolved),
    };
  }

  async getById(_tenantId: string, id: string): Promise<StockSummary> {
    const row = await this.prisma.warehouseStock.findFirst({
      where: { id },
      include: { product: { select: { name: true } } },
    });
    if (row === null) throw new NotFoundError('Stock record not found.');

    return {
      id: row.id,
      productId: row.productId,
      productName: row.product.name,
      warehouseId: row.warehouseId,
      batchId: row.batchId,
      expiryDate: row.expiryDate?.toISOString() ?? null,
      quantity: row.quantity.toString(),
      reserved: row.reserved.toString(),
      available: row.quantity.minus(row.reserved).toString(),
    };
  }
}
