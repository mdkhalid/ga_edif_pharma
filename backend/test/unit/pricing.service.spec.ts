import { PricingService, type PriceLinesRequest } from '../../src/modules/pricing/application/pricing.service';
import { type PricingRepository } from '../../src/modules/pricing/application/pricing.repository.port';
import { Money } from '../../src/modules/pricing/domain/money.vo';
import { type PriceLineInput } from '../../src/modules/pricing/domain/price-engine';

/**
 * The service is the seam between persistence and the pure engine: it must ask
 * the repository for overrides and pass exactly that map to `priceLines`, so the
 * cart price equals the invoice price. These tests bind the `PricingRepository`
 * token to an in-memory stub — no database, no Prisma — and assert the engine
 * sees the resolved overrides.
 */
const AS_OF = new Date('2026-09-26T00:00:00Z');

function makeService(overrides: Record<string, Money>): PricingService {
  const repo: PricingRepository = {
    resolveOverrides: jest.fn(async () => overrides),
  };
  return new PricingService(repo);
}

describe('PricingService.priceLines', () => {
  it('feeds resolved overrides into the engine as priceOverrides', async () => {
    const service = makeService({ P1: new Money(80), P2: new Money(40) });
    const lines: PriceLineInput[] = [
      { productId: 'P1', quantity: 2, baseUnitPrice: new Money(100) },
      { productId: 'P2', quantity: 1, baseUnitPrice: new Money(50) },
    ];
    const request: PriceLinesRequest = {
      tenantId: 'T1',
      organisationId: 'O1',
      asOf: AS_OF,
      lines,
    };

    const result = await service.priceLines(request);

    // P1: 2 × 80 = 160; P2: 1 × 40 = 40 ⇒ grand total 200.
    expect(result.grandTotal).toBe('200.00');
    expect(result.lines[0]!.effectiveUnitPrice).toBe('80');
    expect(result.lines[1]!.effectiveUnitPrice).toBe('40');
  });

  it('falls back to the catalogue base price when the repository returns no override', async () => {
    const service = makeService({});
    const lines: PriceLineInput[] = [
      { productId: 'P1', quantity: 3, baseUnitPrice: new Money(100) },
    ];
    const result = await service.priceLines({
      tenantId: 'T1',
      organisationId: 'O1',
      asOf: AS_OF,
      lines,
    });
    expect(result.grandTotal).toBe('300.00');
  });

  it('passes any supplied schemes through to the engine unchanged', async () => {
    const repo: PricingRepository = { resolveOverrides: jest.fn(async () => ({})) };
    const service = new PricingService(repo);
    const scheme = {
      id: 'S1',
      kind: 'PERCENTAGE' as const,
      percentOff: 10,
      validFrom: new Date('2020-01-01'),
      validTo: new Date('2030-01-01'),
      stackable: true,
      priority: 1,
      productId: 'P1',
    };
    const result = await service.priceLines({
      tenantId: 'T1',
      organisationId: 'O1',
      asOf: AS_OF,
      lines: [{ productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) }],
      schemes: [scheme],
    });
    // 10% off 100 ⇒ 90; the service must have forwarded the scheme to the engine.
    expect(result.grandTotal).toBe('90.00');
    expect(result.lines[0]!.discounts[0]!.schemeId).toBe('S1');
  });
});
