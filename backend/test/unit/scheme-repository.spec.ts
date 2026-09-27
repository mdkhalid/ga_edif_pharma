import { PrismaSchemeRepository } from '../../src/modules/pricing/infra/scheme.repository.prisma';
import { type ResolveSchemesInput } from '../../src/modules/pricing/application/scheme.repository.port';
import { Money } from '../../src/modules/pricing/domain/money.vo';
import { type SchemeKind } from '../../src/modules/pricing/domain/scheme.types';

/**
 * The scheme adapter owns two things and nothing else: the `where` clause that
 * narrows a pricing request to the schemes worth reading, and the mapping from a
 * database row to the domain `Scheme` the pure engine understands. Both are pinned
 * here against a stubbed client, which is enough to prove them — the query itself
 * is PostgreSQL's, and the row shape is generated.
 *
 * ## What a stub cannot prove, stated plainly
 *
 * The `where` clause is asserted as a *value*, not executed. A real-database test
 * would additionally prove that Prisma accepts this exact filter against the
 * `scheme` table and that `combo_product_ids` really is a `TEXT[]` that `hasSome`
 * can query. That is why this file also checks the one thing a stub *can* prove and
 * a real test would not: that the adapter never filters on `tenantId` itself.
 *
 * The tenant filter is the security-critical property. It is injected by the
 * scoping extension from ambient context, so an adapter that added `tenantId` to
 * `where` would be redundant, and one that *dropped* the extension's injection would
 * be a cross-tenant discount leak. Keeping `tenantId` out of `where` is what lets
 * the extension do the one job it is audited for.
 */

const AS_OF = new Date('2026-09-26T00:00:00Z');
const TENANT = '11111111-1111-1111-1111-111111111111';
const P1 = '22222222-2222-2222-2222-222222222222';
const P2 = '33333333-3333-3333-3333-333333333333';
const C1 = '44444444-4444-4444-4444-444444444444';

/** A `Decimal`-alike: the adapter only ever calls `toString()` on it. */
function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

interface StubRow {
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
}

function makeRepository(rows: StubRow[]): { repo: PrismaSchemeRepository; findMany: jest.Mock } {
  const findMany = jest.fn(async () => rows);
  // The adapter only touches `scheme`; the scoping extension is not in play here,
  // which is precisely why the test asserts the `where` clause by value.
  const prisma = { scheme: { findMany } } as unknown as ConstructorParameters<typeof PrismaSchemeRepository>[0];
  return { repo: new PrismaSchemeRepository(prisma), findMany };
}

function request(overrides: Partial<ResolveSchemesInput> = {}): ResolveSchemesInput {
  return {
    tenantId: TENANT,
    productIds: [P1, P2],
    categoryIds: [C1],
    asOf: AS_OF,
    ...overrides,
  };
}

function row(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: 'S1',
    kind: 'PERCENTAGE',
    productId: P1,
    categoryId: null,
    percentOff: decimal('10.00'),
    flatOff: null,
    minQty: null,
    buyQty: null,
    freeQty: null,
    comboProductIds: [],
    validFrom: new Date('2020-01-01T00:00:00Z'),
    validTo: new Date('2030-01-01T00:00:00Z'),
    stackable: true,
    priority: 1,
    ...overrides,
  };
}

/** The `where` the adapter passed to its single query. */
function whereOf(findMany: jest.Mock): Record<string, unknown> {
  return findMany.mock.calls[0]![0].where as Record<string, unknown>;
}

describe('PrismaSchemeRepository.resolveSchemes — selection', () => {
  it('asks only for ACTIVE schemes that are valid at asOf', async () => {
    const { repo, findMany } = makeRepository([]);

    await repo.resolveSchemes(request());

    const where = whereOf(findMany);
    expect(where['status']).toBe('ACTIVE');
    expect(where['validFrom']).toEqual({ lte: AS_OF });
    expect(where['validTo']).toEqual({ gte: AS_OF });
  });

  it('never filters on tenantId — the scoping extension injects it', async () => {
    const { repo, findMany } = makeRepository([]);

    await repo.resolveSchemes(request());

    // If this ever appears, the tenant filter has been duplicated by hand and the
    // extension's injection is no longer the single audited source of it.
    expect(JSON.stringify(whereOf(findMany))).not.toContain('tenant');
    expect(JSON.stringify(whereOf(findMany))).not.toContain(TENANT);
  });

  it('selects product-, category-, combo- and order-level schemes in one query', async () => {
    const { repo, findMany } = makeRepository([]);

    await repo.resolveSchemes(request());

    // Four ways a scheme can matter to an order. A missing one is a missed discount
    // that is invisible until a buyer notices they paid full price.
    expect(whereOf(findMany)['OR']).toEqual([
      { productId: { in: [P1, P2] } },
      { categoryId: { in: [C1] } },
      { comboProductIds: { hasSome: [P1, P2] } },
      { productId: null, categoryId: null },
    ]);
  });

  it('passes empty id lists through rather than omitting the branch', async () => {
    // A line with no category must not turn `categoryId: { in: undefined }` into a
    // branch Prisma rejects, and must not silently widen it either.
    const { repo, findMany } = makeRepository([]);

    await repo.resolveSchemes(request({ categoryIds: [] }));

    expect(whereOf(findMany)['OR']).toContainEqual({ categoryId: { in: [] } });
  });
});

describe('PrismaSchemeRepository.resolveSchemes — row mapping', () => {
  it('maps a percentage scheme, turning the decimal column into a number', async () => {
    const { repo } = makeRepository([row({ percentOff: decimal('12.50') })]);

    const [scheme] = await repo.resolveSchemes(request());

    expect(scheme).toEqual({
      id: 'S1',
      kind: 'PERCENTAGE',
      productId: P1,
      categoryId: undefined,
      percentOff: 12.5,
      flatOff: undefined,
      minQty: undefined,
      buyQty: undefined,
      freeQty: undefined,
      comboProductIds: [],
      validFrom: new Date('2020-01-01T00:00:00Z'),
      validTo: new Date('2030-01-01T00:00:00Z'),
      stackable: true,
      priority: 1,
    });
  });

  it('maps a flat amount into Money rather than a JS float', async () => {
    // The whole reason money is a value object: 0.1 + 0.2 must be 0.30. A float
    // here would reintroduce the drift the engine exists to prevent.
    const { repo } = makeRepository([row({ kind: 'FLAT', percentOff: null, flatOff: decimal('0.10') })]);

    const [scheme] = await repo.resolveSchemes(request());

    expect(scheme!.flatOff).toBeInstanceOf(Money);
    expect(scheme!.flatOff!.plus(new Money('0.20')).toString()).toBe('0.30');
    expect(scheme!.percentOff).toBeUndefined();
  });

  it('carries the free-goods and combo fields through', async () => {
    const { repo } = makeRepository([
      row({ kind: 'FREE_GOODS', percentOff: null, minQty: 2, buyQty: 2, freeQty: 1 }),
      row({ id: 'S2', kind: 'COMBO', percentOff: decimal('25'), productId: null, comboProductIds: [P1, P2] }),
    ]);

    const [free, combo] = await repo.resolveSchemes(request());

    expect(free).toMatchObject({ kind: 'FREE_GOODS', minQty: 2, buyQty: 2, freeQty: 1 });
    expect(combo).toMatchObject({ kind: 'COMBO', percentOff: 25, comboProductIds: [P1, P2] });
  });

  it('maps an order-level scheme to no product and no category', async () => {
    // Both absent is what makes the engine treat it as order-level. Mapping null to
    // `null` instead of `undefined` would make every line look targeted at nothing
    // and the scheme would silently apply per line instead of once per order.
    const { repo } = makeRepository([row({ productId: null, categoryId: null })]);

    const [scheme] = await repo.resolveSchemes(request());

    expect(scheme!.productId).toBeUndefined();
    expect(scheme!.categoryId).toBeUndefined();
  });

  it('returns an empty list when nothing matches, rather than undefined', async () => {
    const { repo } = makeRepository([]);

    await expect(repo.resolveSchemes(request())).resolves.toEqual([]);
  });
});
