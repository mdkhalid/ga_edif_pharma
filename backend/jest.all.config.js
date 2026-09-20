/**
 * Coverage across every database-backed suite, not just the unit tests.
 *
 * ## Why this exists
 *
 * The gate in `jest.config.js` runs the unit suite alone, and the Phase 1
 * services are not unit-testable in any meaningful way: `OrderService.place` is
 * a transaction that locks rows, reserves stock and writes history. Its
 * behaviour *is* PostgreSQL's behaviour, and the only test worth writing for it
 * drives a real database. Measured with unit tests alone those files are 0%
 * covered, and the global ratchet fell from a floor set before they existed —
 * which is a gate that fails for a reason unrelated to quality, and the fastest
 * way to get a gate ignored.
 *
 * So the number that is enforced is the one the whole test suite produces. The
 * DB-backed suites need a migrated, seeded PostgreSQL (see
 * `test/support/database.ts`), which is why CI must provide one for this run.
 *
 * `maxWorkers: 1`: the concurrency suite asserts invariants under contention and
 * the DB suites share one database. Parallel workers would make both flakier,
 * and the suite is seconds long either way.
 */

const base = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: [
    '<rootDir>/src',
    '<rootDir>/test/unit',
    '<rootDir>/test/integration',
    '<rootDir>/test/concurrency',
    '<rootDir>/test/isolation',
  ],
  // `\.spec\.ts$` does not match `foo.integration-spec.ts` (the separator is a
  // hyphen, and the pattern requires a dot), so the four variants are listed
  // explicitly rather than joined by a looser pattern.
  testRegex: '\\.(spec|integration-spec|concurrency-spec|isolation-spec)\\.ts$',
  testTimeout: 60_000,
  maxWorkers: 1,
  collectCoverage: true,
};
