import {
  GLOBAL_MODELS,
  TENANT_SCOPED_MODELS,
  applyTenantScope,
  applyTenantScopingToOperation,
  tenantScopingExtension,
} from '../../src/database/tenant-scoping.extension';
import { createRequestContext, requestContext } from '../../src/common/context/request-context';

/**
 * Tenant scoping is the single most security-critical rule in the codebase: one
 * missed filter is a cross-tenant data breach. These tests pin the decision
 * itself, which is why `applyTenantScope` was extracted as a pure function —
 * the rule is asserted directly, without a database and without Prisma
 * internals, and the error branches are reachable.
 */

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/** Runs `fn` inside a request context for `tenantId`. */
function asTenant<T>(tenantId: string | null, fn: () => T): T {
  const context = createRequestContext({ requestId: 'test-request' });
  context.tenantId = tenantId;
  return requestContext.run(context, fn);
}

describe('applyTenantScope', () => {
  describe('models that are not tenant-scoped', () => {
    it('passes a raw query through — there is no model to classify', () => {
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({ model: undefined, operation: '$queryRaw', args: {} }),
      );

      expect(decision.kind).toBe('pass_through');
    });

    it.each(Object.keys(GLOBAL_MODELS))('passes the global model %s through', (model) => {
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({ model, operation: 'findMany', args: { where: {} } }),
      );

      expect(decision.kind).toBe('pass_through');
    });

    it('throws for an unclassified model rather than querying it unscoped', () => {
      // `FutureWidget` is a realistic future table. If someone adds it to the
      // schema and forgets to classify it, this is the failure they get —
      // which is far better than a query that silently returns every tenant's
      // rows. (`Product` used to play this role; it is now classified.)
      expect(() =>
        asTenant(TENANT_A, () =>
          applyTenantScope({ model: 'FutureWidget', operation: 'findMany', args: {} }),
        ),
      ).toThrow(/not classified for tenant scoping/);

      expect(() =>
        asTenant(TENANT_A, () =>
          applyTenantScope({ model: 'FutureWidget', operation: 'findMany', args: {} }),
        ),
      ).toThrow(/FutureWidget/);
    });

    it('names the file to edit in the error, so the fix is obvious', () => {
      expect(() =>
        asTenant(TENANT_A, () =>
          applyTenantScope({ model: 'FutureWidget', operation: 'findMany', args: {} }),
        ),
      ).toThrow(/tenant-scoping\.extension\.ts/);
    });
  });

  describe('when there is no request context', () => {
    it('throws instead of running unscoped', () => {
      // A seed or script that forgot to wrap itself. Defaulting to "no filter"
      // here would be the silent leak the extension exists to prevent.
      expect(() =>
        applyTenantScope({ model: 'Session', operation: 'findMany', args: {} }),
      ).toThrow(/outside a request context/);
    });

    it('suggests both remedies in the message', () => {
      expect(() =>
        applyTenantScope({ model: 'Session', operation: 'findMany', args: {} }),
      ).toThrow(/runUnscoped/);
    });
  });

  describe('read operations on a tenant-scoped model', () => {
    it.each([
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'findUnique',
      'findUniqueOrThrow',
      'count',
      'aggregate',
      'groupBy',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
    ])('injects the tenant filter into %s', (operation) => {
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({ model: 'Session', operation, args: { where: { status: 'PLACED' } } }),
      );

      expect(decision.kind).toBe('rewrite');
      if (decision.kind !== 'rewrite') throw new Error('unreachable');
      expect(decision.args['where']).toEqual({ status: 'PLACED', tenantId: TENANT_A });
    });

    it('scopes count, so a total cannot disclose another tenant’s volume', () => {
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({ model: 'Session', operation: 'count', args: {} }),
      );

      expect(decision.kind).toBe('rewrite');
      if (decision.kind !== 'rewrite') throw new Error('unreachable');
      expect(decision.args['where']).toEqual({ tenantId: TENANT_A });
    });

    it('preserves the caller’s existing where clause', () => {
      const where = { status: 'PLACED', total: { gte: 1000 } };
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({ model: 'Session', operation: 'findMany', args: { where } }),
      );

      if (decision.kind !== 'rewrite') throw new Error('unreachable');
      expect(decision.args['where']).toEqual({ ...where, tenantId: TENANT_A });
    });

    it('does not mutate the caller’s args object', () => {
      // The extension must be transparent: a caller that reuses its args object
      // after the call must not find a tenant filter it never wrote.
      const args: Record<string, unknown> = { where: { status: 'PLACED' } };
      asTenant(TENANT_A, () =>
        applyTenantScope({ model: 'Session', operation: 'findMany', args }),
      );

      expect(args).toEqual({ where: { status: 'PLACED' } });
    });
  });

  describe('a caller-supplied tenantId', () => {
    it('is overwritten, not merged — a request body cannot choose its tenant', () => {
      // The whole point: `{ where: { tenantId: B } }` from a client must be
      // replaced with the authenticated tenant, never honoured.
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({
          model: 'Session',
          operation: 'findMany',
          args: { where: { tenantId: TENANT_B } },
        }),
      );

      if (decision.kind !== 'rewrite') throw new Error('unreachable');
      expect(decision.args['where']).toEqual({ tenantId: TENANT_A });
    });

    it('is overwritten on create as well', () => {
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({
          model: 'Session',
          operation: 'create',
          args: { data: { tenantId: TENANT_B, status: 'PLACED' } },
        }),
      );

      if (decision.kind !== 'rewrite') throw new Error('unreachable');
      expect(decision.args['data']).toEqual({ tenantId: TENANT_A, status: 'PLACED' });
    });
  });

  describe('create operations', () => {
    it.each(['create', 'createMany', 'createManyAndReturn'])(
      'injects the tenant into %s',
      (operation) => {
        const decision = asTenant(TENANT_A, () =>
          applyTenantScope({ model: 'Session', operation, args: { data: { status: 'PLACED' } } }),
        );

        if (decision.kind !== 'rewrite') throw new Error('unreachable');
        expect(decision.args['data']).toEqual({ status: 'PLACED', tenantId: TENANT_A });
      },
    );

    it('injects into every row of an array payload', () => {
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({
          model: 'Session',
          operation: 'createMany',
          args: { data: [{ sku: 'A' }, { sku: 'B' }] },
        }),
      );

      if (decision.kind !== 'rewrite') throw new Error('unreachable');
      expect(decision.args['data']).toEqual([
        { sku: 'A', tenantId: TENANT_A },
        { sku: 'B', tenantId: TENANT_A },
      ]);
    });
  });

  describe('upsert', () => {
    it('scopes both the lookup and the insert', () => {
      // Missing the `create` half would let a caller insert into whichever
      // tenant they named in the payload.
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({
          model: 'Session',
          operation: 'upsert',
          args: {
            where: { id: 'order-1' },
            create: { id: 'order-1', tenantId: TENANT_B },
          },
        }),
      );

      if (decision.kind !== 'rewrite') throw new Error('unreachable');
      expect(decision.args['where']).toEqual({ id: 'order-1', tenantId: TENANT_A });
      expect(decision.args['create']).toEqual({ id: 'order-1', tenantId: TENANT_A });
    });
  });

  describe('operations that carry neither a where nor data', () => {
    it('passes through untouched', () => {
      const decision = asTenant(TENANT_A, () =>
        applyTenantScope({ model: 'Session', operation: 'findRaw', args: { foo: 'bar' } }),
      );

      expect(decision.kind).toBe('pass_through');
    });
  });

  describe('when the context has no tenant', () => {
    it('throws for a model that is not tenant-optional', () => {
      // This is the case the guard is supposed to prevent. If it is reached, the
      // route forgot `@SkipTenantScope()` — and refusing is the only safe answer.
      expect(() =>
        asTenant(null, () =>
          applyTenantScope({ model: 'Session', operation: 'findMany', args: {} }),
        ),
      ).toThrow(/no tenant on the request context/);
    });

    it('passes through for a tenant-optional model', () => {
      // `OtpChallenge` is created before the account (and therefore the tenant)
      // is known, so its tenant is genuinely nullable.
      const decision = asTenant(null, () =>
        applyTenantScope({ model: 'OtpChallenge', operation: 'create', args: { data: {} } }),
      );

      expect(decision.kind).toBe('pass_through');
    });
  });

  describe('the explicit bypass', () => {
    it('lifts the filter inside withoutTenantScope, and restores it after', async () => {
      const context = createRequestContext({ requestId: 'test-request' });
      context.tenantId = TENANT_A;

      await requestContext.run(context, async () => {
        await requestContext.withoutTenantScope(async () => {
          const decision = applyTenantScope({
            model: 'Session',
            operation: 'findMany',
            args: {},
          });
          expect(decision.kind).toBe('pass_through');
        });

        // Restored: the bypass must not outlive the block that declared it, or
        // one login-time query would leave the rest of the request unscoped.
        const after = applyTenantScope({ model: 'Session', operation: 'findMany', args: {} });
        expect(after.kind).toBe('rewrite');
      });
    });

    it('lifts the filter for runUnscoped, which is how seeds and jobs work', async () => {
      await requestContext.runUnscoped(async () => {
        const decision = applyTenantScope({ model: 'Session', operation: 'findMany', args: {} });
        expect(decision.kind).toBe('pass_through');
      }, 'test');
    });

    it('still refuses an unclassified model even when bypassed', async () => {
      // The classification check runs before the bypass is consulted, on purpose:
      // bypassing the *filter* is a legitimate choice, but an unclassified model
      // is a decision someone has not made yet.
      await expect(
        requestContext.runUnscoped(async () =>
          applyTenantScope({ model: 'FutureWidget', operation: 'findMany', args: {} }),
        ),
      ).rejects.toThrow(/not classified for tenant scoping/);
    });
  });

  describe('the classified model lists', () => {
    it('does not contain duplicates', () => {
      expect(new Set(TENANT_SCOPED_MODELS).size).toBe(TENANT_SCOPED_MODELS.length);
    });

    it('does not classify a model as both scoped and global', () => {
      const overlap = TENANT_SCOPED_MODELS.filter((model) =>
        Object.keys(GLOBAL_MODELS).includes(model),
      );
      expect(overlap).toEqual([]);
    });

    it('gives every global model a reason', () => {
      // "It was easier" is how a leak gets introduced, so each entry must
      // justify itself.
      for (const [model, reason] of Object.entries(GLOBAL_MODELS)) {
        expect(reason.length).toBeGreaterThan(40);
        expect(model.length).toBeGreaterThan(0);
      }
    });
  });
});

/**
 * The tests above prove the *rule* is correct. They do not prove the rule is
 * *connected* — a refactor that stopped calling `applyTenantScope` from the
 * Prisma hook would leave every one of them passing while the application
 * quietly stopped filtering.
 *
 * These tests drive the handler Prisma actually calls. `Prisma.defineExtension`
 * returns an opaque builder function whose `name` and `query` live in a closure
 * and cannot be read back, which is why the handler is exported separately.
 */
describe('applyTenantScopingToOperation', () => {
  it('injects the tenant filter — the rule is wired, not just correct', async () => {
    const query = jest.fn().mockResolvedValue('rows');

    const result = await asTenant(TENANT_A, () =>
      applyTenantScopingToOperation({
        model: 'Session',
        operation: 'findMany',
        args: { where: { userId: 'user-1' } },
        query,
      }),
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ where: { userId: 'user-1', tenantId: TENANT_A } });
    expect(result).toBe('rows');
  });

  it('scopes writes, not only reads', async () => {
    const query = jest.fn().mockResolvedValue('created');

    await asTenant(TENANT_A, () =>
      applyTenantScopingToOperation({
        model: 'Session',
        operation: 'create',
        args: { data: { userId: 'user-1' } },
        query,
      }),
    );

    expect(query).toHaveBeenCalledWith({ data: { userId: 'user-1', tenantId: TENANT_A } });
  });

  it('leaves a global model untouched', async () => {
    const query = jest.fn().mockResolvedValue('settings');
    const args = { where: { key: 'ai.provider' } };

    await asTenant(TENANT_A, () =>
      applyTenantScopingToOperation({
        model: 'PlatformSetting',
        operation: 'findMany',
        args,
        query,
      }),
    );

    expect(query).toHaveBeenCalledWith(args);
  });

  it('refuses to run unscoped when there is no request context at all', async () => {
    // Deliberately not wrapped in `asTenant`. A seed or an unwrapped script
    // reaching a tenant-scoped model is a bug, not a licence to return
    // everything — the handler must fail loudly.
    const query = jest.fn();

    await expect(
      applyTenantScopingToOperation({
        model: 'Session',
        operation: 'findMany',
        args: { where: {} },
        query,
      }),
    ).rejects.toThrow(/outside a request context/i);

    expect(query).not.toHaveBeenCalled();
  });

  it('propagates the unclassified-model error rather than silently passing through', async () => {
    const query = jest.fn();

    await expect(
      asTenant(TENANT_A, () =>
        applyTenantScopingToOperation({
          model: 'NotARealModel',
          operation: 'findMany',
          args: {},
          query,
        }),
      ),
    ).rejects.toThrow(/not classified/i);

    // The critical part: the query must never reach the database.
    expect(query).not.toHaveBeenCalled();
  });

  it('returns create data untouched when it is neither an object nor an array', () => {
    // Defensive branch: Prisma does not send `data: null`, but a pass-through
    // here is the difference between a no-op and a crash if it ever does.
    const decision = asTenant(TENANT_A, () =>
      applyTenantScope({
        model: 'Session',
        operation: 'create',
        args: { data: null },
      }),
    );

    expect(decision).toEqual({ kind: 'rewrite', args: { data: null } });
  });
});

describe('tenantScopingExtension', () => {
  it('returns a Prisma extension builder', () => {
    // The extension is opaque by design, so this is the one assertion worth
    // making about it: that the entry point still exists and is the thing
    // `prisma.service.ts` composes. Everything it wires is covered above.
    expect(typeof tenantScopingExtension()).toBe('function');
  });
});

