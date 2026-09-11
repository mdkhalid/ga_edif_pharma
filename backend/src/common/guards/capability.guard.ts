import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Capability, SystemRole } from '@medichain/shared-types';
import { SystemRole as Roles } from '@medichain/shared-types';

import { META } from '../constants/metadata';
import { requestContext } from '../context/request-context';
import { ForbiddenError, UnauthenticatedError } from '../exceptions/domain.exception';

/**
 * Authorises the authenticated principal against the route's declared
 * requirements.
 *
 * Runs after `JwtAuthGuard`, so a principal is guaranteed to exist on any
 * non-public route.
 *
 * ## Capability checks are the default; role checks are the exception
 *
 * A capability names an *action* (`order:approve`). A role names a *bundle* of
 * actions that a tenant administrator can redefine at runtime. Authorising on
 * the capability means a tenant inventing a "Regional Manager" role needs no
 * code change and no deploy — and that is the normal case in this domain, where
 * every distributor organises its back office differently.
 *
 * Role checks are reserved for routes whose meaning *is* the role: reading the
 * tenant's audit log is inherently a tenant-administrator action, and no
 * capability expresses that as precisely.
 *
 * ## Why the missing-capability message is vague
 *
 * The response names the capability that was required but never enumerates what
 * the caller *does* hold. Telling an attacker which other permissions an
 * account has is free reconnaissance for privilege-escalation attempts.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const requiredAll = this.reflector.getAllAndOverride<readonly Capability[]>(
      META.REQUIRED_CAPABILITIES,
      targets,
    );
    const requiredAny = this.reflector.getAllAndOverride<readonly Capability[]>(
      META.REQUIRED_ANY_CAPABILITY,
      targets,
    );
    const requiredRoles = this.reflector.getAllAndOverride<readonly SystemRole[]>(
      META.REQUIRED_ROLES,
      targets,
    );

    const hasRequirement =
      (requiredAll?.length ?? 0) > 0 ||
      (requiredAny?.length ?? 0) > 0 ||
      (requiredRoles?.length ?? 0) > 0;

    if (!hasRequirement) return true;

    const principal = requestContext.principal();
    if (principal === null) throw new UnauthenticatedError();

    // The platform super-admin is the one principal that is not expressible as
    // a capability: it operates *outside* any tenant, on the platform itself.
    // Granting it every capability in the enum would make it indistinguishable
    // from a tenant admin that happened to be over-privileged, and would need
    // updating every time a capability is added.
    if (principal.roles.includes(Roles.SUPER_ADMIN)) return true;

    const held = new Set(principal.capabilities);

    if (requiredAll !== undefined && requiredAll.length > 0) {
      const missing = requiredAll.filter((capability) => !held.has(capability));
      if (missing.length > 0) {
        throw new ForbiddenError(
          `This action requires the ${missing.join(', ')} permission.`,
        );
      }
    }

    if (requiredAny !== undefined && requiredAny.length > 0) {
      const satisfied = requiredAny.some((capability) => held.has(capability));
      if (!satisfied) {
        throw new ForbiddenError(
          `This action requires one of: ${requiredAny.join(', ')}.`,
        );
      }
    }

    if (requiredRoles !== undefined && requiredRoles.length > 0) {
      const satisfied = requiredRoles.some((role) => principal.roles.includes(role));
      if (!satisfied) {
        throw new ForbiddenError(`This action requires one of the roles: ${requiredRoles.join(', ')}.`);
      }
    }

    return true;
  }
}
