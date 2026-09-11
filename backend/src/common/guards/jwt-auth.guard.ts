import {
  CanActivate,
  Inject,
  Injectable,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '@medichain/shared-types';

import { META } from '../constants/metadata';
import { requestContext } from '../context/request-context';
import { UnauthenticatedError } from '../exceptions/domain.exception';
import {
  SESSION_AUTHORITY,
  TOKEN_VERIFIER,
  type SessionAuthority,
  type TokenVerifier,
} from '../ports/auth.port';

/**
 * Authenticates every request unless the route is marked `@Public()`.
 *
 * ## Fail closed
 *
 * This guard is registered globally, so a new controller is protected by
 * default and forgetting to add it is impossible. The opposite arrangement —
 * `@UseGuards()` on each controller — fails open: the one controller that
 * forgets to add it serves data to anyone.
 *
 * ## Two-stage verification, and why both stages are required
 *
 * 1. **Signature.** Proves the token was issued by us and has not been edited.
 * 2. **Session authority.** Proves the token is still *allowed*.
 *
 * Stage 1 alone is not enough. A signed token remains cryptographically valid
 * until it expires, so a stolen token, a suspended user, or a role revoked by an
 * administrator would keep working for up to 15 minutes. Stage 2 asks the
 * session store, which is invalidated the moment access changes.
 *
 * The principal is built from the *fresh* grant, not from the token's claims.
 * A token that says `caps: ["order:approve"]` is not trusted to mean it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(SESSION_AUTHORITY) private readonly authority: SessionAuthority,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(META.IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const token = extractBearerToken(request.headers ?? {});

    // A public route with no token is simply anonymous. A public route *with* a
    // token still gets authenticated when the token is valid, so that handlers
    // such as "product detail" can show contract pricing to a signed-in buyer.
    if (isPublic && token === null) return true;
    if (token === null) throw new UnauthenticatedError('An access token is required.');

    const payload = await this.verifier.verifyAccessToken(token);
    const grant = await this.authority.resolveAccessGrant(payload);

    if (grant === null) {
      throw new UnauthenticatedError(
        'This session is no longer valid. Sign in again to continue.',
      );
    }

    // Deliberately re-derived from the grant rather than spread from the token:
    // the token is a hint, the grant is the truth.
    const principal: AuthenticatedPrincipal = {
      userId: grant.userId,
      tenantId: grant.tenantId,
      organisationId: grant.organisationId,
      sessionId: grant.sessionId,
      roles: grant.roles,
      capabilities: grant.capabilities,
      scope: payload.scp,
      actorType: grant.actorType,
    };

    requestContext.setPrincipal(principal);
    return true;
  }
}

/**
 * Reads the bearer token from the `Authorization` header.
 *
 * Returns `null` rather than throwing so the caller can distinguish "no
 * credentials supplied" from "credentials supplied and rejected" — a public
 * route needs the former to be anonymous, while the latter is always an error.
 * The scheme is compared case-insensitively because clients emit both `Bearer`
 * and `bearer`.
 */
export function extractBearerToken(headers: Record<string, unknown>): string | null {
  const raw = headers['authorization'];
  if (typeof raw !== 'string') return null;

  const [scheme, ...rest] = raw.split(' ');
  if (scheme === undefined || scheme.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token === '' ? null : token;
}
