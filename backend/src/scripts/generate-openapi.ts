import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { AppModule } from '../app.module';
import { buildOpenApiDocument } from '../config/openapi';

/**
 * Writes the OpenAPI document to disk.
 *
 * Run via `npm run openapi:generate` (which executes the compiled
 * `dist/scripts/generate-openapi.js`), so the spec is produced from the same
 * code path that serves Swagger UI — see `config/openapi.ts`.
 *
 * ## Why the application is created but never initialised
 *
 * `NestFactory.create` builds the module graph and registers the controllers,
 * which is all Swagger needs to scan. Deliberately **not** calling `app.init()`
 * means the lifecycle hooks do not run, so `PrismaService` never opens a
 * connection and the process needs no database. A spec generator that requires
 * a live Postgres is a spec generator that fails in CI for a reason unrelated to
 * the spec.
 *
 * Writes to `openapi.json` under the current working directory (the backend
 * workspace when run through npm), overridable with `OPENAPI_OUTPUT`.
 *
 * ## Running environment
 *
 * Uses the normal validated configuration, so it must run with a non-production
 * `NODE_ENV` (CI sets `NODE_ENV=test`). Production-only rules in `env.schema.ts`
 * — such as rejecting the console SMS provider — are about a *running* service
 * and have nothing to do with spec generation.
 */
async function main(): Promise<void> {
  // `['error']` rather than `false`: Nest's exception zone reports a bootstrap
  // failure through its own logger and then exits. With logging off entirely the
  // process dies non-zero with no message at all, which is exactly the failure
  // this comment was written after debugging.
  const app = await NestFactory.create(AppModule, { logger: ['error'] });

  try {
    const document = buildOpenApiDocument(app);
    const output = resolve(process.cwd(), process.env['OPENAPI_OUTPUT'] ?? 'openapi.json');

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    console.log(
      `OpenAPI document written to ${output} ` +
        `(${Object.keys(document.paths).length} paths, ${Object.keys(document.components?.schemas ?? {}).length} schemas).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  // `console.error` rather than an injected logger: if the application could not
  // be created, there is no logger to inject, and CI needs the reason on stderr.
  console.error('Failed to generate the OpenAPI document:');
  console.error(error);
  // `process.exitCode`, not `process.exit(1)`: on Windows stderr to a pipe is
  // asynchronous, and an immediate exit truncates the very message the operator
  // needs. Setting the code lets Node flush and then exit non-zero on its own.
  process.exitCode = 1;
});
