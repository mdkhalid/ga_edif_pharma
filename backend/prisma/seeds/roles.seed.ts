import type { PrismaClient } from '@prisma/client';

import { SystemRole } from '@medichain/shared-types';

import { ALL_CAPABILITIES, ROLE_DEFINITIONS } from './role-definitions';

/**
 * Seeds the platform role and every tenant role, with their capabilities.
 *
 * ## Two kinds of role
 *
 * **Global** roles have `tenantId: null` and are shared by every tenant. Only
 * `SUPER_ADMIN` qualifies: it operates on the platform rather than inside a
 * tenant, so it cannot belong to one.
 *
 * **Tenant** roles are created per tenant from the same definitions. They are
 * copies, not references — which is the point. Once seeded, a tenant can clone
 * and modify its own "Order Manager" without affecting any other tenant, and
 * without a deploy.
 *
 * ## Idempotency, and the capability-sync problem
 *
 * Roles are upserted on their natural key. Capabilities are then *reconciled*
 * rather than appended:
 *
 *   - capabilities in the definition but missing from the database are added,
 *   - capabilities in the database but absent from the definition are removed.
 *
 * The removal is the important half. Without it, deleting a capability from
 * `role-definitions.ts` — say, because a duty is being separated — would leave
 * it granted in every existing environment, and the change would appear to have
 * had no effect. Reconciling makes the definitions the source of truth.
 *
 * The one exception is a role a tenant has customised. Reconciliation only
 * applies to `isSystem` roles; a tenant's own roles are never touched, because
 * the seed has no opinion about them.
 */
export async function seedRoles(prisma: PrismaClient, tenantId: string): Promise<void> {
  // ------------------------------------------------------------- SUPER_ADMIN
  //
  // Global, and granted every capability in the system.
  //
  // The guard special-cases this role so it passes every check regardless — but
  // the capability rows are still written, because a support tool that renders
  // "what can this role do?" reads them, and an empty list would be misleading.
  const superAdmin = await prisma.role.upsert({
    where: { id: await findGlobalRoleId(prisma, SystemRole.SUPER_ADMIN) },
    update: { name: 'Platform Super Administrator', isSystem: true },
    create: {
      tenantId: null,
      code: SystemRole.SUPER_ADMIN,
      name: 'Platform Super Administrator',
      description:
        'Operates the platform itself: manages tenants, global configuration, AI providers ' +
        'and integration credentials. Belongs to no tenant and sees no tenant business data ' +
        'unless impersonating, which is audited.',
      isSystem: true,
    },
    select: { id: true },
  });

  await reconcileCapabilities(prisma, superAdmin.id, ALL_CAPABILITIES);
  console.log(`  role          ${SystemRole.SUPER_ADMIN} (global, ${ALL_CAPABILITIES.length} capabilities)`);

  // ----------------------------------------------------------- tenant roles
  for (const definition of ROLE_DEFINITIONS) {
    const roleId = await findTenantRoleId(prisma, tenantId, definition.code);

    const role = await prisma.role.upsert({
      where: { id: roleId },
      update: {
        name: definition.name,
        description: definition.description,
        // Never reset `isSystem` on update: an operator who has deliberately
        // cloned a system role should not have it silently promoted back.
      },
      create: {
        tenantId,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: definition.isSystem,
      },
      select: { id: true },
    });

    await reconcileCapabilities(prisma, role.id, definition.capabilities);
    console.log(
      `  role          ${definition.code} (${definition.capabilities.length} capabilities)`,
    );
  }
}

/**
 * Makes the role's capability rows match the definition exactly.
 *
 * `createMany` with `skipDuplicates` for the additions and a single `deleteMany`
 * for the removals, rather than a per-capability upsert loop: a role can hold
 * sixty capabilities, and sixty round trips on every seed run is a slow way to
 * reach the same result.
 */
async function reconcileCapabilities(
  prisma: PrismaClient,
  roleId: string,
  capabilities: readonly string[],
): Promise<void> {
  const wanted = [...new Set(capabilities)];

  await prisma.roleCapability.createMany({
    data: wanted.map((capability) => ({ roleId, capability })),
    // The unique index on (roleId, capability) makes this safe to re-run.
    skipDuplicates: true,
  });

  await prisma.roleCapability.deleteMany({
    where: { roleId, capability: { notIn: wanted } },
  });
}

/**
 * Finds the id of a global role, or returns a sentinel that forces a create.
 *
 * `upsert` needs a `where` on a unique field, and the natural key here is
 * `(tenantId, code)` with `tenantId` null. Prisma's generated `RoleWhereUniqueInput`
 * cannot express that, so the lookup is done explicitly and a non-existent id is
 * passed to force the `create` branch. A `cuid`-shaped sentinel is used rather
 * than an empty string so that a malformed value fails loudly rather than
 * matching something unintended.
 */
async function findGlobalRoleId(prisma: PrismaClient, code: string): Promise<string> {
  const existing = await prisma.role.findFirst({
    where: { code, tenantId: null },
    select: { id: true },
  });
  return existing?.id ?? '00000000-0000-0000-0000-000000000000';
}

/** The same lookup, scoped to one tenant. */
async function findTenantRoleId(
  prisma: PrismaClient,
  tenantId: string,
  code: string,
): Promise<string> {
  const existing = await prisma.role.findFirst({
    where: { code, tenantId },
    select: { id: true },
  });
  return existing?.id ?? '00000000-0000-0000-0000-000000000000';
}
