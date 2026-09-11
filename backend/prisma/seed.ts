import { PrismaClient } from '@prisma/client';

import { requestContext } from '../src/common/context/request-context';
import { seedAdminUsers } from './seeds/admin-user.seed';
import { seedFeatureFlags } from './seeds/feature-flags.seed';
import { seedPlatformSettings } from './seeds/platform-settings.seed';
import { seedRoles } from './seeds/roles.seed';
import { seedTenant } from './seeds/tenant.seed';

/**
 * Database seed entry point.
 *
 * Run with `npm run db:seed` (which invokes `prisma db seed`).
 *
 * ## Design rules every seed here follows
 *
 * **Idempotent.** Running the seed twice must leave the database exactly as
 * running it once did. Every write is an `upsert` keyed on a natural key, never a
 * `create`. This matters more than it sounds: the seed runs on every fresh
 * environment *and* is often re-run by a developer who is unsure whether it
 * already ran. A non-idempotent seed produces duplicate roles, which silently
 * double a user's effective capabilities.
 *
 * **Unscoped, explicitly.** Seeds run outside any request, so there is no tenant
 * on the ambient context and the tenant-scoping extension would refuse every
 * query. `requestContext.runUnscoped()` states that intent once, here, rather
 * than each seed reaching for an escape hatch of its own. It also means the
 * extension's refusal message never has to be worked around by weakening the
 * extension.
 *
 * **Ordered by dependency.** Tenant first (roles reference it), then roles, then
 * the things that reference roles. The sequence below is the dependency graph,
 * written out.
 *
 * **No production secrets.** Nothing here creates a credential that would matter
 * if it leaked. The development admin password is generated randomly and printed
 * once; the seed refuses to create a user at all when `NODE_ENV=production`.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const startedAt = Date.now();

  console.log('Seeding MediChain…');

  await requestContext.runUnscoped(async () => {
    // 1. The tenant everything else belongs to.
    const tenant = await seedTenant(prisma);

    // 2. Global roles (tenantId = null) and per-tenant roles.
    await seedRoles(prisma, tenant.id);

    // 3. Runtime configuration: platform-wide, encrypted where secret.
    await seedPlatformSettings(prisma);

    // 4. Feature flags: platform defaults plus any per-tenant override.
    await seedFeatureFlags(prisma, tenant.id);

    // 5. Development accounts. Refuses to run in production.
    await seedAdminUsers(prisma, tenant.id);
  }, 'seed');

  console.log(`Seeding complete in ${Date.now() - startedAt}ms.`);
}

main()
  .catch((error: unknown) => {
    console.error('Seeding failed:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
