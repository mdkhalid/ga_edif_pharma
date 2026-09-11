import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '@medichain/shared-types';

import { requestContext } from '../context/request-context';
import { UnauthenticatedError } from '../exceptions/domain.exception';

/**
 * Injects the authenticated principal into a handler parameter.
 *
 *   @Get('me')
 *   me(@CurrentUser() principal: AuthenticatedPrincipal) { ... }
 *
 * Reading from AsyncLocalStorage rather than `request.user` means the same
 * decorator works in a guard, an interceptor, a queue consumer and a cron —
 * places where there is no Express request object at all.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): AuthenticatedPrincipal => {
    const principal = requestContext.principal();
    if (principal === null) {
      // Reaching here means a handler that requires a principal was routed
      // without the auth guard. Fail closed rather than pass `undefined` down.
      throw new UnauthenticatedError();
    }
    return principal;
  },
);

/**
 * Injects the principal, or `null` when the route is anonymous.
 *
 * Used by routes that behave differently for signed-in and anonymous callers —
 * a product page showing contract pricing to a logged-in buyer, for example.
 */
export const OptionalUser = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): AuthenticatedPrincipal | null =>
    requestContext.principal(),
);

/** Injects the current tenant id. Throws when the route has no tenant. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string => {
    const tenantId = requestContext.tenantId();
    if (tenantId === null) {
      throw new UnauthenticatedError('This request is not scoped to a tenant.');
    }
    return tenantId;
  },
);
