import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { createRequestContext, requestContext } from '../../src/common/context/request-context';
import {
  extendPrismaClient,
  type ExtendedPrismaClient,
} from '../../src/database/prisma.service';

/**
 * Shared support for the database-backed suites (integration and concurrency):
 * a real PostgreSQL connection and a real request context.
 *
 * ## Why these tests talk to a real database
 *
 * The behaviour under test is PostgreSQL's: row locking, `FOR UPDATE` blocking,
 * trigram similarity, plus a migration that must apply. `pg-mem` and SQLite
 * implement none of it faithfully, and a test that passes against a fake proves
 * nothing about the thing being tested.
 *
 * ## The database
 *
 * The suites use the `DATABASE_URL` they are given, which is the same contract
 * the application uses. Locally that comes from `backend/.env` (read below when
 * jest has not been handed the variable); in CI it is a service container. The
 * database must be migrated and seeded — `npm run db:migrate && npm run db:seed`
 * — and the suites fail loudly rather than silently skipping when it is not,
 * because a suite that quietly passes without running is worse than no suite.
 */

/**
 * Fills in anything `backend/.env` provides that the environment does not.
 *
 * Every key is considered, not just `DATABASE_URL`: bailing out as soon as one
 * variable was supplied would leave the rest undefined, so a CI job that sets
 * `DATABASE_URL` explicitly and expects `.env` to supply `REDIS_URL` would get
 * an unset URL and a confusing failure. Real environment variables always win,
 * and a missing file is not an error — CI has no `.env`.
 */
function loadEnvFile(): void {
  let contents: string;
  try {
    contents = readFileSync(join(__dirname, '..', '..', '.env'), 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null) continue;
    const key = match[1] as string;
    const value = match[2] as string;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Creates a tenant-scoped client pointed at the test database. */
export function createTestPrisma(): ExtendedPrismaClient {
  loadEnvFile();

  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'These database-backed tests need DATABASE_URL. Set it, or provide backend/.env, ' +
        'pointing at a migrated and seeded PostgreSQL database.',
    );
  }

  return extendPrismaClient(new PrismaClient({ datasourceUrl: url }));
}

/**
 * Runs `fn` as an authenticated user of `tenantId`.
 *
 * The scoping extension reads the tenant from ambient context, so a service call
 * outside one throws by design. This is the same context an HTTP request builds.
 */
export async function asTenantUser<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const context = createRequestContext({ requestId: 'db-test' });
  context.tenantId = tenantId;
  return requestContext.run(context, fn);
}

/**
 * The tenant the seed created, or a failure explaining what is missing.
 *
 * `Tenant` is a global (unscoped) model, so this read is deliberately wrapped in
 * `runUnscoped` — the seed and this helper are the only places allowed to look
 * at the tenant registry without already holding a tenant.
 */
export async function seededTenant(prisma: ExtendedPrismaClient): Promise<{ id: string }> {
  const tenant = await requestContext.runUnscoped(
    async () => prisma.tenant.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }),
    'db-test',
  );

  if (tenant === null) {
    throw new Error(
      'No tenant in the database. Run `npm run db:migrate` and `npm run db:seed` against ' +
        'DATABASE_URL before the database-backed suites.',
    );
  }

  return tenant;
}

/**
 * An organisation to act as the buyer for, or a failure explaining what is not
 * seeded. Order placement needs a real one: `customer_order.organisation_id` is
 * a foreign key.
 */
export async function seededBuyerOrganisation(
  prisma: ExtendedPrismaClient,
  tenantId: string,
): Promise<{ id: string }> {
  const organisation = await asTenantUser(tenantId, async () =>
    prisma.organisation.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }),
  );

  if (organisation === null) {
    throw new Error(
      'No organisation in the database. The commerce seed creates one; run `npm run db:seed`.',
    );
  }

  return organisation;
}
