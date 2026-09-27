import { Inject, Injectable } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { Money } from '../domain/money.vo';
import { Scheme, SchemeKind } from '../domain/scheme.types';
import { type ResolveSchemesInput, type SchemeRepository } from '../application/scheme.repository.port';

/**
 * Prisma implementation of the scheme port.
 *
 * Loads only ACTIVE schemes that are valid at `asOf` and relevant to the order:
 * product-targeted, category-targeted, any combo whose products appear, and
 * order-level schemes (no product/category target). The tenant filter is injected
 * by the scoping extension, so `where` uses business keys only. Mapping to the
 * domain `Scheme` shape is the adapter's single job beyond the query.
 */
@Injectable()
export class PrismaSchemeRepository implements SchemeRepository {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
  ) {}

  async resolveSchemes(input: ResolveSchemesInput): Promise<Scheme[]> {
    const rows = await this.prisma.scheme.findMany({
      where: {
        status: 'ACTIVE',
        validFrom: { lte: input.asOf },
        validTo: { gte: input.asOf },
        OR: [
          { productId: { in: [...input.productIds] } },
          { categoryId: { in: [...input.categoryIds] } },
          { comboProductIds: { hasSome: [...input.productIds] } },
          { productId: null, categoryId: null },
        ],
      },
    });

    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: {
    id: string;
    kind: SchemeKind;
    productId: string | null;
    categoryId: string | null;
    percentOff: { toString(): string } | null;
    flatOff: { toString(): string } | null;
    minQty: number | null;
    buyQty: number | null;
    freeQty: number | null;
    comboProductIds: string[];
    validFrom: Date;
    validTo: Date;
    stackable: boolean;
    priority: number;
  }): Scheme {
    return {
      id: row.id,
      kind: row.kind,
      productId: row.productId ?? undefined,
      categoryId: row.categoryId ?? undefined,
      percentOff: row.percentOff !== null ? Number(row.percentOff.toString()) : undefined,
      flatOff: row.flatOff !== null ? new Money(row.flatOff.toString()) : undefined,
      minQty: row.minQty ?? undefined,
      buyQty: row.buyQty ?? undefined,
      freeQty: row.freeQty ?? undefined,
      comboProductIds: row.comboProductIds,
      validFrom: row.validFrom,
      validTo: row.validTo,
      stackable: row.stackable,
      priority: row.priority,
    };
  }
}
