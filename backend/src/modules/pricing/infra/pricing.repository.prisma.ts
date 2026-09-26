import { Inject, Injectable } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { Money } from '../domain/money.vo';
import {
  type PricingRepository,
  type ResolveOverridesInput,
} from '../application/pricing.repository.port';
import { resolvePriceOverrideMap } from '../application/price-override-resolver';

/**
 * Prisma implementation of the pricing port.
 *
 * The tenant filter is injected by the scoping extension, so `where` clauses here
 * address rows by their business keys (organisation, product) only — never by
 * `tenantId` — exactly as the cart and orders services do. The query results are
 * mapped into the adapter-agnostic `ResolverData` and handed to the pure
 * `resolvePriceOverrideMap`, keeping all selection logic database-free and tested.
 */
@Injectable()
export class PrismaPricingRepository implements PricingRepository {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
  ) {}

  async resolveOverrides(input: ResolveOverridesInput): Promise<Record<string, Money>> {
    const productIds = input.lines.map((line) => line.productId);

    // 1. Direct customer overrides — these beat any assigned price list.
    const directRows = await this.prisma.customerPriceOverride.findMany({
      where: { organisationId: input.organisationId, productId: { in: productIds } },
      select: { productId: true, unitPrice: true },
    });
    const directOverrides = new Map(
      directRows.map((row) => [row.productId, row.unitPrice.toString()]),
    );

    // 2. The customer's assigned price list, only if it is ACTIVE and effective now.
    let priceList: { lines: { productId: string; minQty: number; unitPrice: string }[] } | null = null;
    const assignment = await this.prisma.customerPriceList.findFirst({
      where: { organisationId: input.organisationId },
      select: { priceListId: true },
    });
    if (assignment) {
      const list = await this.prisma.priceList.findFirst({
        where: {
          id: assignment.priceListId,
          status: 'ACTIVE',
          effectiveFrom: { lte: input.asOf },
          effectiveTo: { gte: input.asOf },
        },
        select: { lines: { select: { productId: true, minQty: true, unitPrice: true } } },
      });
      if (list) {
        priceList = {
          lines: list.lines.map((line) => ({
            productId: line.productId,
            minQty: line.minQty,
            unitPrice: line.unitPrice.toString(),
          })),
        };
      }
    }

    return resolvePriceOverrideMap({ directOverrides, priceList, lines: input.lines });
  }
}
