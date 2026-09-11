/**
 * Integration tests — real PostgreSQL and Redis via Testcontainers.
 *
 * These are NOT run against an in-memory database. `pg-mem` and SQLite do not
 * implement `FOR UPDATE` locking, `SKIP LOCKED`, partial indexes, `jsonb`
 * operators or NUMERIC precision — which is precisely what these tests exist
 * to verify. A test that passes against a fake database proves nothing.
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
