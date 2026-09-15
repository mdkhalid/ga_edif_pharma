import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork } from '../../../database/unit-of-work';
import {
  buildOffsetMeta,
  parseSortExpression,
  resolveOffset,
} from '../../../common/utils/pagination.util';
import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { AuditService } from '../../audit';
import type { CreateProductDto, ListProductsQuery, UpdateProductDto } from '../api/dto/catalog.dto';

/**
 * Product catalogue.
 *
 * Tenant scoping is automatic via the extended Prisma client. Writes are
 * audited inside the same transaction as the change.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateProductDto,
    actorId?: string,
  ): Promise<{ id: string }> {
    const product = await this.uow.transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description ?? null,
          schedule: dto.schedule,
          hsnCode: dto.hsnCode ?? null,
          strength: dto.strength ?? null,
          packSize: dto.packSize ?? 0,
          packUnit: dto.packUnit ?? null,
          price: new Prisma.Decimal(dto.price),
          saltAliases: dto.saltAliases ?? [],
          compositionKey: dto.compositionKey ?? null,
        },
        select: { id: true },
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'catalog.product.created',
        entity: 'Product',
        entityId: created.id,
        actorId: actorId ?? null,
        metadata: { name: dto.name, schedule: dto.schedule },
      });

      return created;
    });

    return { id: product.id };
  }

  async list(query: ListProductsQuery): Promise<{
    data: Array<{
      id: string;
      name: string;
      schedule: string;
      price: string;
      status: string;
    }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    const resolved = resolveOffset(query.page, query.pageSize);
    const sort = parseSortExpression(query.sort, ['name', 'price', 'createdAt'] as const, [
      { field: 'createdAt', direction: 'desc' },
    ]);

    const where: Prisma.ProductWhereInput = {
      ...(query.schedule ? { schedule: query.schedule } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const orderBy = sort.map((s) => ({ [s.field]: s.direction }));

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: { id: true, name: true, schedule: true, price: true, status: true },
        orderBy,
        skip: resolved.skip,
        take: resolved.take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        schedule: r.schedule,
        price: r.price.toString(),
        status: r.status,
      })),
      meta: buildOffsetMeta(total, resolved),
    };
  }

  async getById(id: string): Promise<{
    id: string;
    name: string;
    schedule: string;
    price: string;
    status: string;
    strength: string | null;
  } | null> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, schedule: true, price: true, status: true, strength: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      schedule: row.schedule,
      price: row.price.toString(),
      status: row.status,
      strength: row.strength,
    };
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto, actorId: string): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const existing = await this.uow.lockById<{ id: string; status: string }>(
        tx,
        'product',
        id,
        tenantId,
      );
      if (!existing) throw new NotFoundError('Product not found.');

      await tx.product.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
          ...(dto.status !== undefined
            ? { status: dto.status as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' }
            : {}),
        },
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'catalog.product.updated',
        entity: 'Product',
        entityId: id,
        actorId,
        metadata: { ...(dto.name !== undefined ? { name: dto.name } : {}) },
      });
    });
  }
}
