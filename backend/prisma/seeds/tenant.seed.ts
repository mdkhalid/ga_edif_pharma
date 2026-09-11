import type { PrismaClient } from '@prisma/client';

/**
 * The default tenant.
 *
 * A tenant is one pharma company operating on the platform. Even in a
 * single-company deployment the row exists, because `tenant_id` is a required
 * column on every business table — there is no "no tenant" state to code around.
 *
 * ## Why the code is read from the environment
 *
 * The tenant code appears in registration links and in support conversations, so
 * a real deployment wants to choose it. The default, `SUNRISE`, matches the demo
 * data in the documentation so that a developer following `docs/` locally sees
 * what the docs describe.
 */
export async function seedTenant(prisma: PrismaClient): Promise<{ id: string; code: string }> {
  const code = (process.env['SEED_TENANT_CODE'] ?? 'SUNRISE').toUpperCase();

  const tenant = await prisma.tenant.upsert({
    where: { code },
    // Nothing to change on an existing tenant: a re-run must not overwrite
    // values an operator has since edited through the admin portal.
    update: {},
    create: {
      code,
      name: process.env['SEED_TENANT_NAME'] ?? 'Sunrise Pharma Distributors',
      status: 'ACTIVE',
      legalName: 'Sunrise Pharma Distributors Pvt. Ltd.',
      // Deliberately left unset rather than filled with a plausible-looking
      // value. A fake GSTIN that reaches a tax invoice is a real compliance
      // problem, and an obviously empty field is noticed while a wrong one is
      // not.
      gstin: process.env['SEED_TENANT_GSTIN'] ?? null,
      stateCode: process.env['SEED_TENANT_STATE_CODE'] ?? null,
      currency: 'INR',
      supportEmail: process.env['SEED_TENANT_SUPPORT_EMAIL'] ?? 'support@sunrisepharma.local',
    },
    select: { id: true, code: true },
  });

  console.log(`  tenant        ${tenant.code} (${tenant.id})`);
  return tenant;
}
