import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { META } from '../constants/metadata';
import { requestContext } from '../context/request-context';
import { ForbiddenError, UnauthenticatedError } from '../exceptions/domain.exception';

/**
 * Ensures every tenant-owned route runs with a tenant on the context.
 *
 * This is the first of the two independent layers that protect the tenant
 * boundary (the second is the Prisma extension, which injects the filter into
 * every query). Both exist because either one alone has a failure mode:
 *
 *   - the extension alone cannot help when a route *should* be scoped but the
 *     context was never populated — it would see `tenantId === null` and have
 *     to choose between failing every query or skipping the filter;
 *   - the guard alone is bypassed by any code path that queries outside a
 *     request — a queue consumer, a cron, a script.
 *
 * Together, a missing guard cannot leak data (the extension still filters), and
 * a bypassed extension cannot either (the guard already rejected the request).
 *
 * ## Why this cannot be folded into `JwtAuthGuard`
 *
 * Authentication and scoping are different questions with different answers for
 * the same caller. A platform super-admin authenticates successfully but has no
 * tenant; a `@SkipTenantScope()` route is authenticated and deliberately
 * unscoped. Merging them would mean one flag controlling two behaviours, and
 * the first route that needs one but not the other becomes a special case.
 *
 * ## Why `@Public()` is checked here
 *
 * The two guards answer different questions, so a route can be "open" and still
 * be rejected here. `JwtAuthGuard` returns `true` for an anonymous request to a
 * `@Public()` route and deliberately leaves the context without a principal —
 * that is what "anonymous" means. This guard then used to see no principal and
 * throw 401, so every public route returned 401 and the health probes were
 * unusable: a load balancer cannot authenticate, and a readiness probe that
 * always answers 401 tells the balancer nothing about whether Postgres is up.
 *
 * A public route is therefore allowed through without a principal. Note that it
 * does **not** silently enable the scope bypass: an anonymous route that queries
 * a tenant-owned model still fails loudly in the Prisma extension, and must
 * declare `@SkipTenantScope()` to say so explicitly. Granting the bypass here
 * would turn every public route into an unscoped read by default, which is
 * exactly the mistake this guard exists to prevent.
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const skip = this.reflector.getAllAndOverride<boolean>(META.SKIP_TENANT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip === true) {
      // `@SkipTenantScope()` must also lift the filter in the Prisma extension.
      //
      // Without this, the two mechanisms disagree: the guard allows the request
      // through, and the extension then throws because the context has no tenant
      // and the model is not tenant-optional. The route would be unusable, and
      // the error would point at the query rather than at the missing bypass.
      //
      // Setting it here also means the bypass is scoped to exactly the routes
      // that declared it, and it is visible in one place rather than being
      // sprinkled through service code.
      requestContext.enableScopeBypass();
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(META.IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    // See the class note. An anonymous public route carries no principal by
    // design, so requiring one here would reject the request it was meant to
    // allow.
    if (isPublic === true) return true;

    const principal = requestContext.principal();
    if (principal === null) throw new UnauthenticatedError();

    // A principal with no tenant reached a route that requires one. The
    // realistic causes are a platform-staff account calling a tenant endpoint,
    // or a route that forgot `@SkipTenantScope()`. Both are configuration
    // mistakes, and refusing is the only safe response — the alternative is a
    // query that the extension cannot scope.
    if (principal.tenantId === null) {
      throw new ForbiddenError(
        'This endpoint operates on tenant data, but the authenticated account belongs to no tenant. ' +
          'Platform-staff accounts must use the platform endpoints.',
      );
    }

    return true;
  }
}
