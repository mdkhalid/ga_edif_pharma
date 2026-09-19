import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { createRequestContext, requestContext } from '../../../src/common/context/request-context';
import {
  extendPrismaClient,
  type ExtendedPrismaClient,
} from '../../../src/database/prisma.service';

/**
 * Integration-suite support: a real PostgreSQL connection and a real request
 * context.
 *
 * ## Why these tests talk to a real database
 *
 * The behaviour under test here is PostgreSQL's: row locking, trigram
 * similarity, followed by a migration that must apply. `pg-mem` and SQLite
 * implement none of it faithfully, and a test that passes against a fake proves
 * nothing about the thing being tested.
 *
 * ## The database
 *
 * The suite uses the `DATABASE_URL` it is given, which is the same contract the
 * application uses. Locally that comes from `backend/.env` (read below when jest
 * has not been handed the variable); in CI it is a service container. The
 * database must be migrated and seeded — `npm run db:migrate && npm run db:seed`
 * — and the suite fails loudly rather than silently skipping when it is not,
 * because a suite that quietly passes without running is worse than no suite.
 */

/** Reads `backend/.env` when the environment has no `DATABASE_URL` of its own. */
function loadEnvFile(): void {
  if (process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'] !== '') return;

  const envPath = join(__dirname, '..', '..', '..', '.env');
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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
      'These integration tests need DATABASE_URL. Set it, or provide backend/.env, ' +
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
  const context = createRequestContext({ requestId: 'integration-test' });
  context.tenantId = tenantId;
  return requestContext.run(context, fn);
}

/**
 * The tenant the seed created, or a failure explaining what is missing.
 *
 * `Tenant` is a global (unscoped) model, so this read is deliberately wrapped
 * in `runUnscoped` — the seed and this helper are the only places allowed to
 * look at the tenant registry without already having a tenant.
 */
export async function seededTenant(prisma: ExtendedPrismaClient): Promise<{ id: string }> {
  const tenant = await requestContext.runUnscoped(
    async () => prisma.tenant.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }),
    'integration-test',
  );

  if (tenant === null) {
    throw new Error(
      'No tenant in the database. Run `npm run db:migrate` and `npm run db:seed` against ' +
        'DATABASE_URL before the integration suite.',
    );
  }

  return tenant;
}
