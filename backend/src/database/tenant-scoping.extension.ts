import { Prisma } from '@prisma/client';

import { requestContext } from '../common/context/request-context';

/**
 * Automatic tenant scoping.
 *
 * ## The problem this solves
 *
 * In a multi-tenant system the single most damaging bug is not a crash — it is a
 * query that returns another tenant's rows. It is silent, it is a data-protection
 * incident, and it is caused by one forgotten `where` clause in one of hundreds
 * of call sites. Code review does not reliably catch it; a test suite only
 * catches the paths it happens to cover.
 *
 * This extension removes the possibility. Every query against a tenant-scoped
 * model gets the tenant filter injected, whether or not the developer remembered.
 * `prisma.order.findMany({})` returns this tenant's orders, full stop.
 *
 * ## The escape hatches are deliberate and few
 *
 * Three ways a query can run unscoped, all explicit and greppable:
 *
 *   1. `requestContext.withoutTenantScope(fn)` — platform administration.
 *   2. `@SkipTenantScope()` on a route — login, health, platform settings.
 *   3. `requestContext.runUnscoped(fn)` — seeds, migrations, background jobs.
 *
 * ## Why an unknown model throws
 *
 * A new table added to `schema.prisma` and not classified below would default to
 * *unscoped*, which is exactly the silent leak this file exists to prevent. So
 * an unclassified model is an error, not a pass-through: the developer adding a
 * table must make an explicit decision, and CI fails until they do.
 */

/**
 * Models that belong to exactly one tenant and must always be filtered.
 *
 * Adding a model here is a promise: every row carries a non-null `tenantId`, and
 * no query may cross the boundary.
 */
export const TENANT_SCOPED_MODELS = [
  'Organisation',
  'User',
  'Role',
  'Session',
  'RefreshToken',
  'OtpChallenge',
  'AuditLog',
  'OutboxEvent',
  // Phase 1 commerce models. Every one carries a non-null `tenantId` —
  // including the line-item tables, which are denormalised per the schema
  // convention so the extension can filter them directly.
  'Product',
  'WarehouseStock',
  'Cart',
  'CartItem',
  'CustomerOrder',
  'OrderItem',
  'OrderStatusHistory',
] as const;

/**
 * Models that are platform-level and intentionally not tenant-filtered.
 *
 * Each entry needs a reason, because "it was easier" is how a leak gets
 * introduced.
 */
export const GLOBAL_MODELS = {
  /** The tenant registry itself. Reading it is a platform operation. */
  Tenant: 'The tenant registry — a tenant does not scope the list of tenants.',
  /** Encrypted runtime configuration. Global by design; see docs/13. */
  PlatformSetting: 'Runtime configuration is platform-wide and read by the settings service.',
  /** Flags may be global or per-tenant; the service applies the tenant filter itself. */
  FeatureFlag: 'Flags support global rollout, so the filter is applied by the evaluator, not here.',

  /**
   * Role grants. Addressed only by `userId`, which is itself tenant-scoped.
   *
   * This was classified after the extension correctly refused to run a login
   * (`Model "UserRole" is not classified for tenant scoping`), so the reasoning
   * is worth recording.
   *
   * A denormalised `tenantId` column — the approach taken for `RefreshToken` —
   * does not work here, for two independent reasons:
   *
   *   1. Login reads role grants to *discover* the tenant. The grant is
   *      therefore queried before a tenant exists on the context, which is why
   *      `auth.service.ts` wraps the read in `withoutTenantScope`. A filter
   *      injected from the context could not be satisfied by the very query
   *      that establishes it.
   *
   *   2. Platform accounts are not tenant-bound. The `SUPER_ADMIN` role and the
   *      users holding it have `tenantId: null`, so the column would have to be
   *      nullable — and the extension injects a plain equality
   *      (`where: { tenantId }`), which cannot express "this tenant *or*
   *      global". A nullable column here would silently hide the platform
   *      administrator's own role grants, locking them out of their own account.
   *
   * The boundary is still enforced: every read filters on `userId`, and the
   * parent `User` is tenant-scoped, so a cross-tenant row cannot be reached
   * without already holding another tenant's user id.
   */
  UserRole:
    'Role grants are addressed by userId and are read during login before a tenant is known. ' +
    'Platform accounts have no tenant, so a scoped column would be nullable and the equality ' +
    'filter the extension injects cannot express "tenant or global".',

  /**
   * Capabilities attached to a role. Addressed only by `roleId`.
   *
   * Same nullable-column problem as `UserRole`: global roles (`SUPER_ADMIN`) have
   * `tenantId: null`, so their capability rows have no tenant to carry. The
   * parent `Role` is tenant-scoped, and every read filters on `roleId`.
   */
  RoleCapability:
    'Capabilities are addressed by roleId. Global roles have no tenant, so the scoped column ' +
    'would be nullable and unrepresentable by the equality filter. The parent Role is scoped.',
} as const;

const SCOPED = new Set<string>(TENANT_SCOPED_MODELS);
const GLOBAL = new Set<string>(Object.keys(GLOBAL_MODELS));

/** Operations that read or mutate rows and therefore accept a `where`. */
const WHERE_OPERATIONS = new Set([
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
]);

/** Operations that create rows and therefore accept `data`. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/**
 * Models whose rows are written before a tenant is known, or which are
 * legitimately tenant-optional.
 *
 * `Session` is the important one: a login attempt resolves the user (and thus
 * the tenant) inside the request, but the session row is created after the
 * tenant is known, so it *is* scoped. `OtpChallenge` is created for a
 * pre-authentication flow, so its tenant is nullable and the filter is applied
 * only when the context has one.
 */
const TENANT_OPTIONAL_MODELS = new Set<string>(['OtpChallenge', 'OutboxEvent']);

/**
 * Reads the tenant for this query.
 *
 * Returns `undefined` when the query must run unfiltered, and throws when the
 * situation is ambiguous — because guessing is how data leaks.
 */
function resolveTenantScope(model: string): string | undefined {
  const context = requestContext.get();

  if (context === undefined) {
    // No request context at all: a seed, a migration, or a script that has not
    // wrapped itself. Refuse rather than run unscoped by accident.
    throw new Error(
      `Query on tenant-scoped model "${model}" ran outside a request context. ` +
        'Wrap it in requestContext.runUnscoped(fn) if unscoped access is intended, or ' +
        'requestContext.run({...}, fn) with an explicit tenant.',
    );
  }

  if (context.bypassTenantScope) return undefined;

  if (context.tenantId === null) {
    // An optional model legitimately has no tenant in some flows — an OTP
    // challenge is created before the account is resolved. No filter is applied
    // and no tenant is injected, which is the correct behaviour for a row whose
    // tenant is genuinely unknown at write time.
    if (TENANT_OPTIONAL_MODELS.has(model)) return undefined;

    throw new Error(
      `Query on tenant-scoped model "${model}" ran with no tenant on the request context. ` +
        'The route is missing @SkipTenantScope() or the principal was never attached — ' +
        'either way, running the query unscoped would return every tenant’s rows.',
    );
  }

  return context.tenantId;
}

/**
 * The shape `$allOperations` receives.
 *
 * Prisma types this hook as a union over every model and every operation, so the
 * `args` and `query` parameters are narrowed per combination and a single
 * generic implementation cannot satisfy all of them. Rather than scatter casts
 * through the body, the contract is stated once here.
 *
 * The cast is confined to this boundary: everything below it is ordinary
 * JavaScript on a `Record<string, unknown>`, and the caller's real types are
 * unaffected because the extension is transparent at the call site.
 */
export interface AllOperationsArgs {
  model: string | undefined;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * The outcome of applying the scoping rule to one operation.
 *
 * `rewrite` carries the arguments to run instead of the caller's; `pass_through`
 * means the caller's arguments are already correct. Returning a decision rather
 * than mutating in place is what makes this testable without Prisma: the whole
 * security rule is now a pure function of (model, operation, args, context).
 */
export type ScopeDecision =
  | { readonly kind: 'pass_through' }
  | { readonly kind: 'rewrite'; readonly args: Record<string, unknown> };

/**
 * Applies the tenant scoping rule to a single Prisma operation.
 *
 * Exported for testing, and deliberately free of Prisma types: the decision is
 * the part worth asserting on, and it is the part that must not regress. The
 * alternative — testing through a live Prisma client — would make the suite
 * slower, require a database, and still not reach the error branches.
 *
 * Throws rather than returning a pass-through when the situation is ambiguous.
 * Every `throw` below represents a case where silently continuing would query
 * without a tenant filter.
 */
export function applyTenantScope(input: {
  model: string | undefined;
  operation: string;
  args: Record<string, unknown>;
}): ScopeDecision {
  const { model, operation, args } = input;

  if (model === undefined) {
    // Raw queries (`$queryRaw`) bypass the extension entirely by design. They
    // are used only in infrastructure code that scopes explicitly, and every
    // one of them carries a comment saying so.
    return { kind: 'pass_through' };
  }

  if (GLOBAL.has(model)) return { kind: 'pass_through' };

  if (!SCOPED.has(model)) {
    throw new Error(
      `Model "${model}" is not classified for tenant scoping. Add it to ` +
        'TENANT_SCOPED_MODELS or GLOBAL_MODELS in tenant-scoping.extension.ts. ' +
        'An unclassified model would be queried without a tenant filter.',
    );
  }

  const tenantId = resolveTenantScope(model);
  if (tenantId === undefined) return { kind: 'pass_through' };

  if (WHERE_OPERATIONS.has(operation)) {
    return {
      kind: 'rewrite',
      args: { ...args, where: { ...(args['where'] as object | undefined), tenantId } },
    };
  }

  if (CREATE_OPERATIONS.has(operation)) {
    return {
      kind: 'rewrite',
      args: { ...args, data: injectTenantIntoData(args['data'], tenantId) },
    };
  }

  if (operation === 'upsert') {
    return {
      kind: 'rewrite',
      args: {
        ...args,
        where: { ...(args['where'] as object | undefined), tenantId },
        create: injectTenantIntoData(args['create'], tenantId),
      },
    };
  }

  return { kind: 'pass_through' };
}

/**
 * The `$allOperations` handler.
 *
 * Extracted from `tenantScopingExtension` so the wiring itself is testable.
 * `Prisma.defineExtension` returns an opaque builder function — its `name` and
 * `query` are captured in a closure and are not readable from the return value —
 * so a test cannot reach the hook through the extension object. Keeping the
 * handler as a named function means a test can drive exactly what Prisma drives,
 * and the only thing left uncovered is the framework glue.
 *
 * That distinction matters here: a test suite that covers `applyTenantScope`
 * thoroughly but never proves the hook calls it would stay green through a
 * refactor that disconnected tenant scoping entirely.
 */
export async function applyTenantScopingToOperation(
  params: AllOperationsArgs,
): Promise<unknown> {
  const { model, operation, args, query } = params;

  const decision = applyTenantScope({ model, operation, args });

  return query(decision.kind === 'rewrite' ? decision.args : args);
}

/**
 * Builds the Prisma client extension.
 *
 * `$allOperations` rather than per-operation hooks: one code path means the
 * scoping rule cannot be applied to `findMany` and forgotten on `count`, which
 * would leak through a total. (A `count` that ignores the filter tells the caller
 * how many rows exist across all tenants — a subtle but real disclosure.)
 */
export function tenantScopingExtension() {
  return Prisma.defineExtension({
    name: 'tenant-scoping',
    query: {
      $allModels: {
        async $allOperations(params: unknown) {
          return applyTenantScopingToOperation(params as AllOperationsArgs);
        },
      },
    },
  });
}

/**
 * Adds `tenantId` to a create payload.
 *
 * Handles both the single-object and the array form (`createMany`). An explicit
 * `tenantId` in the payload is overwritten, not merged: accepting the caller's
 * value would let a request body choose which tenant it writes into.
 */
function injectTenantIntoData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) =>
      item !== null && typeof item === 'object' ? { ...item, tenantId } : item,
    );
  }
  if (data !== null && typeof data === 'object') {
    return { ...data, tenantId };
  }
  return data;
}
