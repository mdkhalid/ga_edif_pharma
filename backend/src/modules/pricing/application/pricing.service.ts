import { Inject, Injectable } from '@nestjs/common';

import { Scheme } from '../domain/scheme.types';
import { priceLines, type PriceLineInput, type PricingResult } from '../domain/price-engine';
import { PRICING_REPOSITORY, type PricingRepository, type PricingLineKey } from './pricing.repository.port';

export interface PriceLinesRequest {
  readonly tenantId: string;
  readonly organisationId: string;
  /** The instant at which pricing is evaluated (scheme/list validity is relative to it). */
  readonly asOf: Date;
  readonly lines: readonly PriceLineInput[];
  /**
   * Discount schemes. Empty in P2 — the engine still honours them so P3 merely
   * has to feed this slot without touching the pricing path.
   */
  readonly schemes?: readonly Scheme[];
}

/**
 * Combines persistence with the pure pricing engine. The repository resolves the
 * per-product override prices; those are fed straight into `priceLines` as its
 * `priceOverrides`, so the cart and invoice always price against the same
 * resolved prices. This is the single entry point the cart/orders/invoice steps
 * will call from P3 onward.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(PRICING_REPOSITORY) private readonly repository: PricingRepository,
  ) {}

  async priceLines(request: PriceLinesRequest): Promise<PricingResult> {
    const overrideKeys: PricingLineKey[] = request.lines.map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
    }));

    const priceOverrides = await this.repository.resolveOverrides({
      tenantId: request.tenantId,
      organisationId: request.organisationId,
      lines: overrideKeys,
      asOf: request.asOf,
    });

    return priceLines([...request.lines], {
      asOf: request.asOf,
      schemes: [...(request.schemes ?? [])],
      priceOverrides,
    });
  }
}
