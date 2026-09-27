import { PricingService, type PriceLinesRequest } from '../../src/modules/pricing/application/pricing.service';
import { type PricingRepository } from '../../src/modules/pricing/application/pricing.repository.port';
import { type SchemeRepository, type ResolveSchemesInput } from '../../src/modules/pricing/application/scheme.repository.port';
import { Money } from '../../src/modules/pricing/domain/money.vo';
import { type Scheme } from '../../src/modules/pricing/domain/scheme.types';
import { type PriceLineInput } from '../../src/modules/pricing/domain/price-engine';

/**
 * The service is the seam between persistence and the pure engine: it must ask the
 * repositories for overrides and schemes and pass exactly those to `priceLines`, so
 * the cart price equals the invoice price. These tests bind both repository tokens
 * to in-memory stubs — no database, no Prisma.
 */
const AS_OF = new Date('2026-09-26T00:00:00Z');

function makeService(overrides: Record<string, Money>, schemes: readonly Scheme[] = []): {
  service: PricingService;
  schemeRepo: SchemeRepository;
} {
  const priceRepo: PricingRepository = {
    resolveOverrides: jest.fn(async () => overrides),
  };
  const schemeRepo: SchemeRepository = {
    resolveSchemes: jest.fn(async (_: ResolveSchemesInput) => [...schemes]),
  };
  return { service: new PricingService(priceRepo, schemeRepo), schemeRepo };
}

describe('PricingService.priceLines', () => {
  it('feeds resolved overrides into the engine as priceOverrides', async () => {
    const { service } = makeService({ P1: new Money(80), P2: new Money(40) });
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
    const { service } = makeService({});
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
    const { service } = makeService({});
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

  it('loads schemes from the repository when the caller supplies none', async () => {
    // This is the normal path: schemes are data an admin manages, so pricing must
    // read them from the database rather than depend on the caller to know about
    // them. If this regresses, a live scheme silently stops being applied.
    const scheme: Scheme = {
      id: 'S1',
      kind: 'PERCENTAGE',
      percentOff: 10,
      productId: 'P1',
      validFrom: new Date('2020-01-01'),
      validTo: new Date('2030-01-01'),
      stackable: true,
      priority: 1,
    };
    const { service, schemeRepo } = makeService({}, [scheme]);

    const result = await service.priceLines({
      tenantId: 'T1',
      organisationId: 'O1',
      asOf: AS_OF,
      lines: [{ productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) }],
    });

    expect(result.grandTotal).toBe('90.00');
    expect(schemeRepo.resolveSchemes).toHaveBeenCalledWith({
      tenantId: 'T1',
      productIds: ['P1'],
      categoryIds: [],
      asOf: AS_OF,
    });
  });

  it('passes the order categories to the scheme repository, dropping the absent ones', async () => {
    // A combo scheme is selected by product, a category scheme by category; the
    // repository is asked for both. `undefined` categories must not reach the
    // query as literal nulls, which would match schemes scoped to nothing.
    const { service, schemeRepo } = makeService({});

    await service.priceLines({
      tenantId: 'T1',
      organisationId: 'O1',
      asOf: AS_OF,
      lines: [
        { productId: 'P1', categoryId: 'C1', quantity: 1, baseUnitPrice: new Money(100) },
        { productId: 'P2', quantity: 1, baseUnitPrice: new Money(50) },
      ],
    });

    expect(schemeRepo.resolveSchemes).toHaveBeenCalledWith(
      expect.objectContaining({ productIds: ['P1', 'P2'], categoryIds: ['C1'] }),
    );
  });

  it('does not query for schemes when the caller supplied them', async () => {
    const { service, schemeRepo } = makeService({});

    await service.priceLines({
      tenantId: 'T1',
      organisationId: 'O1',
      asOf: AS_OF,
      lines: [{ productId: 'P1', quantity: 1, baseUnitPrice: new Money(100) }],
      schemes: [],
    });

    expect(schemeRepo.resolveSchemes).not.toHaveBeenCalled();
  });
});
