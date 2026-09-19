/**
 * Integration tests — a real PostgreSQL, reached through `DATABASE_URL`.
 *
 * These are NOT run against an in-memory database. `pg-mem` and SQLite do not
 * implement `FOR UPDATE` locking, `SKIP LOCKED`, partial indexes, trigram
 * similarity, `jsonb` operators or NUMERIC precision — which is precisely what
 * these tests exist to verify. A test that passes against a fake database
 * proves nothing.
 *
 * The database must be migrated and seeded (`npm run db:migrate && npm run
 * db:seed`). Locally that is whatever `backend/.env` points at; in CI it is a
 * service container. The suite fails loudly when the fixtures are absent rather
 * than skipping, because a suite that silently passes without running is worse
 * than no suite.
 *
 * Testcontainers would remove the "migrate and seed first" prerequisite, and is
 * the intended direction — it is not wired yet, and the prerequisite is checked
 * explicitly by `test/integration/support/database.ts` in the meantime.
 */

const base = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test/integration'],
  testRegex: '\\.integration-spec\\.ts$',
  testTimeout: 60_000,
  // A single shared database container; parallel workers would race on migrations.
  maxWorkers: 1,
  collectCoverage: false,
};
