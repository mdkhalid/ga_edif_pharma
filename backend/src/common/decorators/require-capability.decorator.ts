import { SetMetadata } from '@nestjs/common';

import type { Capability, SystemRole } from '@medichain/shared-types';

import { META } from '../constants/metadata';

/**
 * Requires ALL listed capabilities.
 *
 *   @RequireCapability(Capability.ORDER_APPROVE)
 *   @Post(':id/approve')
 *
 * Capability checks, not role checks, are the default. A role is a bundle of
 * capabilities that a tenant admin can redefine; authorising on the capability
 * means adding a custom "Regional Manager" role needs no code change.
 */
export const RequireCapability = (...capabilities: readonly Capability[]) =>
  SetMetadata(META.REQUIRED_CAPABILITIES, capabilities);

/**
 * Requires AT LEAST ONE of the listed capabilities.
 *
 * For routes reachable by several distinct audiences — cancelling an order is
 * available to the buyer who placed it and to back-office staff — where
 * demanding every capability would be wrong.
 */
export const RequireAnyCapability = (...capabilities: readonly Capability[]) =>
  SetMetadata(META.REQUIRED_ANY_CAPABILITY, capabilities);

/**
 * Requires one of the listed system roles.
 *
 * Deliberately the exception, not the rule. Legitimate uses are routes whose
 * semantics are defined by the role itself rather than by a permission —
 * "view the tenant's audit log" is inherently a tenant-admin action.
 */
export const RequireRoles = (...roles: readonly SystemRole[]) =>
  SetMetadata(META.REQUIRED_ROLES, roles);
