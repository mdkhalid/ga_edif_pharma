import { createRequestContext, requestContext } from '../../src/common/context/request-context';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

/**
 * Cross-tenant isolation, driven against a real PostgreSQL.
 *
 * ## Why this exists next to `test/unit/tenant-scoping.spec.ts`
 *
 * That suite proves the *rule*. `applyTenantScope` was written as a pure
 * function precisely so every branch of it could be asserted without a database,
 * and it is. What it cannot prove is that the rule is *attached to a real
 * client* — and the unit suite says so itself, in the comment above
 * `applyTenantScopingToOperation`: a refactor that stopped calling the rule
 * would leave all of it green.
 *
 * The interactive transaction is the gap that comment is really about.
 * `$transaction(async (tx) => …)` does not run on the client that was extended;
 * Prisma builds a separate transaction client for the duration of the callback.
 * If the extension is not composed onto that client, every query inside a
 * transaction is unscoped — and nothing above this file would notice, because
 * the rule is still correct, it is simply not being reached.
 *
 * That is the worst failure mode available here. A service that wraps its reads
 * in a transaction in order to be *more* careful would silently become *less*
 * safe, and the queries most likely to be transactional are the money paths.
 * So the assertions below put tenant B's rows in the database for real, then try
 * to reach them from tenant A through each shape of query — including from
 * inside a transaction.
 *
 * ## Read this before adding a test here
 *
 * The tenant is read from `AsyncLocalStorage`, and `run` only propagates into
 * continuations created *inside* the callback. A `PrismaPromise` is lazy: it does
 * nothing until it is awaited. So this
 *
 *     asTenantUser(tenantA, () => prisma.product.findUnique({ where: { id } }))
 *
 * executes the query *after* the context has been torn down, and the extension
 * refuses it with "ran outside a request context" — a failure that looks like a
 * scoping bug and is entirely an artefact of the test. Every callback below is
 * therefore `async` and awaits inside. The same discipline is what makes the
 * production path correct: a Nest handler awaits its queries within the request
 * scope.
 *
 * ## Two tenants, one database
 *
 * Tenant A is the seeded tenant. Tenant B is created here, because the seed only
 * makes one and a second one is the entire point. Both are removed afterwards
 * (see `afterAll`), and nothing seeded is deleted: only rows this suite created
 * are ever touched, by id.
 */

/** Fixed so a re-run cannot accumulate tenants, and so failures name a stable id. */
const TENANT_B_ID = 'b0000000-0000-4000-8000-0000000000b0';

describe('cross-tenant access', () => {
  let prisma: ExtendedPrismaClient;
  let tenantA: string;
  let productA: string;
  let productB: string;
  /** Rows created mid-test, torn down with the rest. */
  const created: string[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantA = (await seededTenant(prisma)).id;

    await requestContext.runUnscoped(async () => {
      await prisma.tenant.upsert({
        where: { id: TENANT_B_ID },
        update: {},
        create: { id: TENANT_B_ID, code: 'ISOLATION-B', name: 'Isolation Tenant B' },
      });

      // A re-run must not be able to pass on a previous run's leftovers.
      await prisma.product.deleteMany({ where: { tenantId: TENANT_B_ID } });

      const b = await prisma.product.create({
        data: { tenantId: TENANT_B_ID, name: 'Tenant B only', schedule: 'OTC' },
        select: { id: true },
      });
      productB = b.id;
    }, 'isolation-setup');

    productA = await asTenantUser(tenantA, async () => {
      const a = await prisma.product.create({
        data: { tenantId: tenantA, name: 'Tenant A only', schedule: 'OTC' },
        select: { id: true },
      });
      return a.id;
    });
  });

  afterAll(async () => {
    if (prisma === undefined) return;

    // By id, never by tenant: `deleteMany({ where: { tenantId: tenantA } })`
    // would take the seeded catalogue with it.
    await requestContext.runUnscoped(async () => {
      await prisma.product.deleteMany({
        where: { id: { in: [productA, productB, ...created] } },
      });
      await prisma.tenant.deleteMany({ where: { id: TENANT_B_ID } });
    }, 'isolation-teardown');

    await prisma.$disconnect();
  });

  /**
   * The guard against a vacuous suite.
   *
   * Every assertion below is of the form "tenant A cannot see this". All of them
   * would also pass if the row had simply never been written, or if the whole
   * table were empty — a suite that passes because there is nothing to find
   * proves nothing. This asserts the rows are present and reachable when the
   * filter is deliberately lifted, so the only thing hiding them is the scope.
   */
  it('has both tenants’ rows present when the scope is lifted', async () => {
    const ids = await requestContext.runUnscoped(
      async () =>
        (
          await prisma.product.findMany({
            where: { id: { in: [productA, productB] } },
            select: { id: true },
          })
        ).map((row) => row.id),
      'isolation-check',
    );

    expect(ids).toEqual(expect.arrayContaining([productA, productB]));
  });

  describe('reads', () => {
    it('omits the other tenant’s rows from findMany', async () => {
      const ids = await asTenantUser(tenantA, async () =>
        (await prisma.product.findMany({ select: { id: true } })).map((row) => row.id),
      );

      expect(ids).not.toContain(productB);
      expect(ids).toContain(productA);
    });

    it('omits them even when the query asks for them by id', async () => {
      const ids = await asTenantUser(tenantA, async () =>
        (
          await prisma.product.findMany({ where: { id: productB }, select: { id: true } })
        ).map((row) => row.id),
      );

      expect(ids).toEqual([]);
    });

    it('returns null for findUnique on an id it does not own — a 404, not a 403', async () => {
      // The distinction is not cosmetic. A 403 confirms the row exists, which is
      // an existence oracle a caller can walk to enumerate another tenant's
      // catalogue. `findUnique` is the shape that would leak it, because it
      // cannot express "not found" separately from "not yours".
      const row = await asTenantUser(tenantA, async () => ({
        found: await prisma.product.findUnique({ where: { id: productB } }),
      }));

      expect(row.found).toBeNull();
    });

    it('returns null for findFirst on an id it does not own', async () => {
      const row = await asTenantUser(tenantA, async () => ({
        found: await prisma.product.findFirst({ where: { id: productB } }),
      }));

      expect(row.found).toBeNull();
    });

    it('does not count the other tenant’s rows', async () => {
      // A `count` that ignores the filter is a volume disclosure that no row-level
      // assertion would catch: the caller never sees the row, only that it exists.
      const count = await asTenantUser(tenantA, async () => ({
        n: await prisma.product.count({ where: { id: productB } }),
      }));

      expect(count.n).toBe(0);
    });

    it('does not aggregate the other tenant’s rows', async () => {
      const result = await asTenantUser(tenantA, async () => ({
        n: (await prisma.product.aggregate({ where: { id: productB }, _count: { _all: true } }))._count
          ._all,
      }));

      expect(result.n).toBe(0);
    });

    it('does not group the other tenant’s rows', async () => {
      const groups = await asTenantUser(tenantA, async () => ({
        rows: await prisma.product.groupBy({ by: ['id'], where: { id: productB } }),
      }));

      expect(groups.rows).toEqual([]);
    });

    it('gives the two tenants different answers to the same query', async () => {
      // The clearest statement of the property: identical query text, different
      // tenants, disjoint results.
      const [idsA, idsB] = await Promise.all([
        asTenantUser(tenantA, async () =>
          (await prisma.product.findMany({ select: { id: true } })).map((row) => row.id),
        ),
        asTenantUser(TENANT_B_ID, async () =>
          (await prisma.product.findMany({ select: { id: true } })).map((row) => row.id),
        ),
      ]);

      expect(idsA).toContain(productA);
      expect(idsA).not.toContain(productB);
      expect(idsB).toContain(productB);
      expect(idsB).not.toContain(productA);
    });
  });

  describe('writes', () => {
    it('refuses to update another tenant’s row', async () => {
      await expect(
        asTenantUser(tenantA, async () => {
          await prisma.product.update({ where: { id: productB }, data: { name: 'taken over' } });
        }),
      ).rejects.toThrow();

      // And the row is genuinely untouched, not merely reported as refused.
      const after = await asTenantUser(TENANT_B_ID, async () => ({
        name: (await prisma.product.findUnique({ where: { id: productB } }))?.name,
      }));
      expect(after.name).toBe('Tenant B only');
    });

    it('reports zero affected rows when updateMany targets another tenant', async () => {
      const result = await asTenantUser(tenantA, async () => ({
        count: (
          await prisma.product.updateMany({ where: { id: productB }, data: { name: 'taken over' } })
        ).count,
      }));

      expect(result.count).toBe(0);
    });

    it('reports zero affected rows when deleteMany targets another tenant', async () => {
      const result = await asTenantUser(tenantA, async () => ({
        count: (await prisma.product.deleteMany({ where: { id: productB } })).count,
      }));

      expect(result.count).toBe(0);

      const survivor = await asTenantUser(TENANT_B_ID, async () => ({
        id: (await prisma.product.findUnique({ where: { id: productB } }))?.id,
      }));
      expect(survivor.id).toBe(productB);
    });

    it('refuses to delete another tenant’s row', async () => {
      await expect(
        asTenantUser(tenantA, async () => {
          await prisma.product.delete({ where: { id: productB } });
        }),
      ).rejects.toThrow();
    });

    it('writes into the authenticated tenant when the payload names another one', async () => {
      // A request body must not be able to choose its tenant. The extension
      // overwrites rather than merges; if it merged, a caller could plant a row
      // in any tenant by adding one field to a create payload.
      const row = await asTenantUser(tenantA, async () => {
        const record = await prisma.product.create({
          data: { tenantId: TENANT_B_ID, name: 'smuggled', schedule: 'OTC' },
          select: { id: true, tenantId: true },
        });
        return record;
      });
      created.push(row.id);

      expect(row.tenantId).toBe(tenantA);
    });
  });

  describe('a tenant named in the query', () => {
    it('cannot widen a read — the filter is replaced, not merged', async () => {
      const ids = await asTenantUser(tenantA, async () =>
        (
          await prisma.product.findMany({
            where: { tenantId: TENANT_B_ID },
            select: { id: true },
          })
        ).map((record) => record.id),
      );

      expect(ids).not.toContain(productB);
      // The filter is *replaced*, so the query becomes tenant A's rows — not
      // an intersection (which would be empty) and not B's.
      expect(ids).toContain(productA);
    });

    it('cannot widen a count', async () => {
      const { count, ownCount } = await asTenantUser(tenantA, async () => ({
        count: await prisma.product.count({ where: { tenantId: TENANT_B_ID } }),
        ownCount: await prisma.product.count(),
      }));

      expect(count).toBe(ownCount);
    });
  });

  describe('inside an interactive transaction', () => {
    /**
     * The reason this file exists.
     *
     * `prisma.$transaction(async (tx) => …)` hands the callback a *different*
     * client object. Whether the scoping extension is composed onto it is a
     * property of how Prisma builds that client, not of the rule in
     * `tenant-scoping.extension.ts`, so nothing in the unit suite can assert it.
     */
    it('still hides the other tenant’s rows', async () => {
      const seen = await asTenantUser(tenantA, async () =>
        prisma.$transaction(async (tx) => {
          const list = await tx.product.findMany({ select: { id: true } });
          const byId = await tx.product.findUnique({ where: { id: productB } });
          const total = await tx.product.count({ where: { id: productB } });

          return { ids: list.map((row) => row.id), byId, total };
        }),
      );

      expect(seen.ids).not.toContain(productB);
      expect(seen.ids).toContain(productA);
      expect(seen.byId).toBeNull();
      expect(seen.total).toBe(0);
    });

    it('still refuses a write to another tenant’s row', async () => {
      await expect(
        asTenantUser(tenantA, async () =>
          prisma.$transaction(async (tx) => {
            await tx.product.update({ where: { id: productB }, data: { name: 'taken over' } });
          }),
        ),
      ).rejects.toThrow();

      const after = await asTenantUser(TENANT_B_ID, async () => ({
        name: (await prisma.product.findUnique({ where: { id: productB } }))?.name,
      }));
      expect(after.name).toBe('Tenant B only');
    });

    it('still writes into the authenticated tenant', async () => {
      const row = await asTenantUser(tenantA, async () =>
        prisma.$transaction(async (tx) => {
          const record = await tx.product.create({
            data: { tenantId: TENANT_B_ID, name: 'smuggled in a transaction', schedule: 'OTC' },
            select: { id: true, tenantId: true },
          });
          return record;
        }),
      );
      created.push(row.id);

      expect(row.tenantId).toBe(tenantA);
    });

    it('scopes a read that follows a write in the same transaction', async () => {
      // The realistic money path: reserve stock, then re-read what you reserved.
      // A transaction client that lost the extension would read across tenants
      // exactly where correctness matters most.
      const seen = await asTenantUser(tenantA, async () =>
        prisma.$transaction(async (tx) => {
          await tx.product.create({
            data: { tenantId: TENANT_B_ID, name: 'written then read', schedule: 'OTC' },
            select: { id: true },
          });

          return tx.product.findMany({
            where: { name: 'written then read' },
            select: { id: true, tenantId: true },
          });
        }),
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.tenantId).toBe(tenantA);
      if (seen[0] !== undefined) created.push(seen[0].id);
    });
  });

  describe('the escape hatch', () => {
    it('does not outlive withoutTenantScope', async () => {
      // Restoring the scope is the property that keeps a legitimate platform
      // read from turning the rest of the request unscoped.
      const seen = await asTenantUser(tenantA, async () => {
        const unscoped = await requestContext.withoutTenantScope(
          async () => await prisma.product.findMany({ where: { id: productB }, select: { id: true } }),
        );
        const scoped = await prisma.product.findMany({
          where: { id: productB },
          select: { id: true },
        });

        return { unscoped: unscoped.map((row) => row.id), scoped: scoped.map((row) => row.id) };
      });

      expect(seen.unscoped).toEqual([productB]);
      expect(seen.scoped).toEqual([]);
    });

    it('refuses a query with no context at all rather than running unscoped', async () => {
      // Deliberately outside `asTenantUser`. A seed or script that forgot to wrap
      // itself gets an error, not every tenant's rows.
      await expect(prisma.product.findMany({ select: { id: true } })).rejects.toThrow(
        /outside a request context/,
      );
    });

    it('refuses a query when the context has no tenant', async () => {
      // A context exists but carries no tenant: the route is missing
      // `@SkipTenantScope()`, or the principal was never attached. Both are bugs,
      // and running unscoped is not an acceptable answer to either.
      const context = createRequestContext({ requestId: 'isolation-no-tenant' });
      context.tenantId = null;

      await expect(
        requestContext.run(context, async () => await prisma.product.count()),
      ).rejects.toThrow(/no tenant on the request context/);
    });
  });
});
