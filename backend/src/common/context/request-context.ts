import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthenticatedPrincipal } from '@medichain/shared-types';

/**
 * Per-request context, propagated via AsyncLocalStorage.
 *
 * This is what makes automatic tenant scoping possible. Instead of threading a
 * `tenantId` argument through every service and repository method — where one
 * forgotten parameter becomes a cross-tenant data leak — the value lives in
 * ambient context and the Prisma extension reads it directly.
 *
 * Two independent layers then protect the tenant boundary:
 *   1. the guard rejects a request that lacks a tenant,
 *   2. the query extension injects the tenant filter into every query.
 * A single missed guard therefore cannot leak another tenant's rows.
 */
export interface RequestContext {
  /** Unique per HTTP request. Generated if the caller did not supply one. */
  readonly requestId: string;
  /** Caller-supplied trace id, or `requestId` when absent. */
  readonly correlationId: string;
  readonly startedAt: number;
  readonly ip: string | null;
  readonly userAgent: string | null;

  /** Resolved from the authenticated principal. Null before authentication. */
  tenantId: string | null;
  principal: AuthenticatedPrincipal | null;

  /**
   * Escape hatch for the small set of operations that legitimately run without
   * a tenant: login (we do not know the tenant yet), platform settings, and
   * migrations. Setting this is explicit and greppable — it should appear in a
   * handful of places, never in ordinary business code.
   */
  bypassTenantScope: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  /** Runs `fn` with the given context. Every async continuation inherits it. */
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  /**
   * Returns the context or throws. Use inside request-scoped code where its
   * absence indicates a programming error, not a legitimate condition.
   */
  require(): RequestContext {
    const context = storage.getStore();
    if (context === undefined) {
      throw new Error(
        'No request context available. This code ran outside a request scope — ' +
          'use requestContext.get() if absence is expected.',
      );
    }
    return context;
  },

  /** The current tenant, or null when unauthenticated / bypassed. */
  tenantId(): string | null {
    return storage.getStore()?.tenantId ?? null;
  },

  /** The authenticated principal, or null. */
  principal(): AuthenticatedPrincipal | null {
    return storage.getStore()?.principal ?? null;
  },

  /** Attaches the principal once authentication succeeds. */
  setPrincipal(principal: AuthenticatedPrincipal): void {
    const context = storage.getStore();
    if (context === undefined) return;
    context.principal = principal;
    context.tenantId = principal.tenantId;
  },

  /** Enables tenant-scope bypass for the remainder of this request. */
  enableScopeBypass(): void {
    const context = storage.getStore();
    if (context !== undefined) context.bypassTenantScope = true;
  },

  /** Runs `fn` with tenant scoping bypassed, restoring the previous flag after. */
  async withoutTenantScope<T>(fn: () => Promise<T>): Promise<T> {
    const context = storage.getStore();
    if (context === undefined) return fn();

    const previous = context.bypassTenantScope;
    context.bypassTenantScope = true;
    try {
      return await fn();
    } finally {
      context.bypassTenantScope = previous;
    }
  },

  /**
   * Runs `fn` outside any request, with tenant scoping explicitly disabled.
   *
   * This is for code that has no HTTP request at all — database seeds,
   * migrations, one-off scripts, and scheduled jobs that operate platform-wide.
   * It creates a synthetic context rather than leaving the store empty, because
   * an empty store is indistinguishable from "the developer forgot to wrap
   * this", and the tenant-scoping extension refuses that case for good reason.
   *
   * The synthetic context is still a real context, so loggers, the audit trail
   * and the scoping extension all behave predictably — they simply see
   * `bypassTenantScope: true` and a `SYSTEM`-ish origin.
   *
   * Prefer `requestContext.run({...}, fn)` with a real tenant for anything that
   * belongs to one tenant. Reaching for this in ordinary business code is a bug.
   */
  async runUnscoped<T>(fn: () => Promise<T>, reason = 'unscoped'): Promise<T> {
    const context = createRequestContext({
      requestId: `sys_${randomId()}`,
      correlationId: `sys_${reason}`,
    });
    context.bypassTenantScope = true;
    return storage.run(context, fn);
  },
};

/** Short, collision-resistant id for contexts that have no HTTP request. */
function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Creates a context for a request that has not been authenticated yet. */
export function createRequestContext(input: {
  requestId: string;
  correlationId?: string;
  ip?: string | null;
  userAgent?: string | null;
}): RequestContext {
  return {
    requestId: input.requestId,
    correlationId: input.correlationId ?? input.requestId,
    startedAt: Date.now(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    tenantId: null,
    principal: null,
    bypassTenantScope: false,
  };
}
