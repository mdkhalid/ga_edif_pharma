import type { PrismaClient } from '@prisma/client';

/**
 * Seeds feature flags.
 *
 * ## Two rows per flag, deliberately
 *
 * The platform default row has `tenantId: null`. A tenant-specific row shadows
 * it. Keeping both means a tenant can be opted in to a flag before it is enabled
 * platform-wide — which is how a rollout actually works: enable for the one
 * customer who asked, watch it, then flip the global default.
 *
 * A single row with a mutable `tenant_id` could not express that, because
 * changing the default would clobber every per-tenant override.
 *
 * ## Why rollout is a percentage rather than a list
 *
 * `rolloutPercentage` is evaluated against a hash of the tenant id, so a tenant
 * that is inside the rollout stays inside it across requests. A random
 * per-request evaluation would give one tenant a feature on some requests and
 * not others, which presents as an intermittent bug rather than a rollout.
 */

interface FlagDefinition {
  readonly key: string;
  readonly enabled: boolean;
  readonly rolloutPercentage: number;
  readonly description: string;
}

const FLAGS: readonly FlagDefinition[] = [
  {
    key: 'mobile_app_enabled',
    enabled: true,
    rolloutPercentage: 100,
    description: 'The React Native mobile app may sign in and place orders.',
  },
  {
    key: 'online_payments_enabled',
    enabled: false,
    rolloutPercentage: 0,
    description:
      'Offer online payment at checkout. Off by default: until a real gateway is configured ' +
      'and its webhook signature verification is verified end to end, orders should settle ' +
      'on credit or against an advance.',
  },
  {
    key: 'credit_orders_enabled',
    enabled: true,
    rolloutPercentage: 100,
    description: 'Allow orders to be placed against an approved credit limit.',
  },
  {
    key: 'multi_warehouse',
    enabled: false,
    rolloutPercentage: 0,
    description:
      'Split stock across several warehouses and fulfil from the nearest one. Off until the ' +
      'inventory module ships in phase 3 — the flag exists so the rollout is a switch, not a ' +
      'deployment.',
  },
  {
    key: 'salt_smart_suggest',
    enabled: true,
    rolloutPercentage: 100,
    description:
      'Suggest alternative brands when a search matches a salt composition. This is the ' +
      'behaviour the brief asked for: searching "cetirizine + paracetamol" returns every ' +
      'product containing that combination, not just the one whose name was typed.',
  },
];

export async function seedFeatureFlags(prisma: PrismaClient, tenantId: string): Promise<void> {
  // The tenant is accepted but deliberately unused: no per-tenant override is
  // created by default. Creating one that merely copies the platform default
  // would make the flag look tenant-specific and freeze it — a later change to
  // the platform default would then have no effect on this tenant, which is a
  // confusing way to discover that an override exists. Overrides are created
  // deliberately, from the admin portal.
  void tenantId;

  for (const flag of FLAGS) {
    const existingGlobal = await prisma.featureFlag.findFirst({
      where: { key: flag.key, tenantId: null },
      select: { id: true },
    });

    await prisma.featureFlag.upsert({
      where: { id: existingGlobal?.id ?? '00000000-0000-0000-0000-000000000000' },
      update: {
        // The description is safe to refresh — it is documentation, not state.
        // `enabled` and `rolloutPercentage` are deliberately NOT updated: an
        // operator may have changed them, and a seed run must not silently
        // revert a flag that was turned on to resolve an incident.
        description: flag.description,
      },
      create: {
        key: flag.key,
        tenantId: null,
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
        description: flag.description,
      },
    });
  }

  console.log(`  flags         ${FLAGS.length} platform defaults`);
}
