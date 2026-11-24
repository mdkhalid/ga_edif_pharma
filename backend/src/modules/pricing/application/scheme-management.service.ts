import { Inject, Injectable } from '@nestjs/common';

import { Prisma, SchemeKind, SchemeStatus } from '@prisma/client';
import type { OffsetPaginated, SchemeSummary } from '@medichain/shared-types';

import {
  ExtendedPrismaClient,
  PRISMA_EXTENDED,
} from '../../../database/prisma.service';
import {
  BusinessRuleViolationError,
  NotFoundError,
} from '../../../common/exceptions/domain.exception';
import { AuditService } from '../../audit';
import type { CreateSchemeDto, UpdateSchemeDto, ListSchemesQueryDto } from '../api/dto/scheme.dto';

export type CreateSchemeInput = CreateSchemeDto;
export type UpdateSchemeInput = UpdateSchemeDto;
export type ListSchemesInput = ListSchemesQueryDto;

type SchemeRow = Prisma.SchemeGetPayload<object>;

/**
 * Map a stored row to the JSON shape the admin client consumes.
 *
 * Decimals and dates are objects in Prisma, not values a browser can use, so the
 * conversion happens at this boundary rather than leaking into the controller.
 */
function toSchemeSummary(row: SchemeRow): SchemeSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    kind: row.kind,
    status: row.status,
    productId: row.productId,
    categoryId: row.categoryId,
    percentOff: row.percentOff === null ? null : Number(row.percentOff),
    flatOff: row.flatOff === null ? null : Number(row.flatOff),
    minQty: row.minQty,
    buyQty: row.buyQty,
    freeQty: row.freeQty,
    comboProductIds: row.comboProductIds,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo.toISOString(),
    stackable: row.stackable,
    priority: row.priority,
  };
}

/**
 * Scheme management (P9 follow-up / admin). CRUD over the persisted `Scheme`
 * rows that the pricing engine resolves. Distinct from the pure `SchemeRepository`
 * port, which only resolves schemes relevant to a pricing request.
 */
@Injectable()
export class SchemeManagementService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly audit: AuditService,
  ) {}

  async list(_tenantId: string, query: ListSchemesInput): Promise<OffsetPaginated<SchemeSummary>> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20;
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;

    const [rows, total] = await Promise.all([
      this.prisma.scheme.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scheme.count({ where }),
    ]);
    const totalPages = Math.ceil(total / pageSize) || 1;
    return {
      data: rows.map(toSchemeSummary),
      meta: { page, pageSize, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  }

  async getById(_tenantId: string, id: string): Promise<SchemeSummary> {
    const row = await this.prisma.scheme.findFirst({ where: { id } });
    if (!row) throw new NotFoundError('Scheme not found.');
    return toSchemeSummary(row);
  }

  async create(tenantId: string, actorId: string, dto: CreateSchemeInput): Promise<{ id: string }> {
    if (new Date(dto.validTo) < new Date(dto.validFrom)) {
      throw new BusinessRuleViolationError('validTo must be on or after validFrom.');
    }
    const created = await this.prisma.scheme.create({
      data: {
        tenantId,
        name: dto.name,
        kind: dto.kind as SchemeKind,
        productId: dto.productId ?? null,
        categoryId: dto.categoryId ?? null,
        percentOff: dto.percentOff != null ? dto.percentOff : null,
        flatOff: dto.flatOff != null ? dto.flatOff : null,
        minQty: dto.minQty ?? null,
        buyQty: dto.buyQty ?? null,
        freeQty: dto.freeQty ?? null,
        comboProductIds: dto.comboProductIds ?? [],
        validFrom: new Date(dto.validFrom),
        validTo: new Date(dto.validTo),
        stackable: dto.stackable ?? true,
        priority: dto.priority ?? 1,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    await this.audit.record({
      tenantId,
      action: 'scheme.created',
      entity: 'Scheme',
      entityId: created.id,
      actorId,
      metadata: { name: dto.name, kind: dto.kind },
    });
    return { id: created.id };
  }

  async update(tenantId: string, id: string, actorId: string, dto: UpdateSchemeInput): Promise<void> {
    const existing = await this.prisma.scheme.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('Scheme not found.');
    await this.prisma.scheme.updateMany({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status as SchemeStatus } : {}),
        ...(dto.percentOff !== undefined ? { percentOff: dto.percentOff } : {}),
        ...(dto.flatOff !== undefined ? { flatOff: dto.flatOff } : {}),
        ...(dto.minQty !== undefined ? { minQty: dto.minQty } : {}),
        ...(dto.buyQty !== undefined ? { buyQty: dto.buyQty } : {}),
        ...(dto.freeQty !== undefined ? { freeQty: dto.freeQty } : {}),
        ...(dto.comboProductIds !== undefined ? { comboProductIds: dto.comboProductIds } : {}),
        ...(dto.validFrom !== undefined ? { validFrom: new Date(dto.validFrom) } : {}),
        ...(dto.validTo !== undefined ? { validTo: new Date(dto.validTo) } : {}),
        ...(dto.stackable !== undefined ? { stackable: dto.stackable } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      },
    });
    await this.audit.record({
      tenantId,
      action: 'scheme.updated',
      entity: 'Scheme',
      entityId: id,
      actorId,
    });
  }

  async archive(tenantId: string, id: string, actorId: string): Promise<void> {
    const existing = await this.prisma.scheme.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('Scheme not found.');
    await this.prisma.scheme.updateMany({ where: { id }, data: { status: 'INACTIVE' } });
    await this.audit.record({
      tenantId,
      action: 'scheme.archived',
      entity: 'Scheme',
      entityId: id,
      actorId,
    });
  }
}
