import { Inject, Injectable } from '@nestjs/common';

import { Scheme } from '../domain/scheme.types';
import { priceLines, type PriceLineInput, type PricingResult } from '../domain/price-engine';
import { PRICING_REPOSITORY, type PricingRepository, type PricingLineKey } from './pricing.repository.port';
import { SCHEME_REPOSITORY, type SchemeRepository } from './scheme.repository.port';

export interface PriceLinesRequest {
  readonly tenantId: string;
  readonly organisationId: string;
  /** The instant at which pricing is evaluated (scheme/list validity is relative to it). */
  readonly asOf: Date;
  readonly lines: readonly PriceLineInput[];
  /**
   * Discount schemes. When omitted, they are loaded from the `SchemeRepository`
   * for the order's products/categories — the normal path once admin-managed
   * schemes exist. Supplied here only to override or for tests.
   */
  readonly schemes?: readonly Scheme[];
}

/**
 * Combines persistence with the pure pricing engine. The repositories resolve the
 * per-product override prices and the applicable discount schemes; both are fed
 * straight into `priceLines` as `priceOverrides` and `schemes`, so the cart and
 * invoice always price against the same resolved data. This is the single entry
 * point the cart/orders/invoice steps will call from P3 onward.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(PRICING_REPOSITORY) private readonly priceRepository: PricingRepository,
    @Inject(SCHEME_REPOSITORY) private readonly schemeRepository: SchemeRepository,
  ) {}

  async priceLines(request: PriceLinesRequest): Promise<PricingResult> {
    const overrideKeys: PricingLineKey[] = request.lines.map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
    }));

    const priceOverrides = await this.priceRepository.resolveOverrides({
      tenantId: request.tenantId,
      organisationId: request.organisationId,
      lines: overrideKeys,
      asOf: request.asOf,
    });

    const schemes = request.schemes ?? (await this.resolveSchemes(request));

    return priceLines([...request.lines], {
      asOf: request.asOf,
      schemes: [...schemes],
      priceOverrides,
    });
  }

  private async resolveSchemes(request: PriceLinesRequest): Promise<Scheme[]> {
    const productIds = request.lines.map((line) => line.productId);
    const categoryIds = request.lines
      .map((line) => line.categoryId)
      .filter((id): id is string => id !== undefined);

    return this.schemeRepository.resolveSchemes({
      tenantId: request.tenantId,
      productIds,
      categoryIds,
      asOf: request.asOf,
    });
  }
}
