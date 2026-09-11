/**
 * Money-path concurrency tests. BLOCKING on every PR.
 *
 * These are correctness tests, not performance tests. They fire N concurrent
 * requests at a single scarce resource and assert the invariant holds:
 *   - exactly one order wins the last unit of stock (no overselling)
 *   - the credit limit is never exceeded (no lost update)
 *   - a redelivered webhook credits exactly once
 *   - the ledger balance equals the sum of its entries
 *   - an advisory-locked cron runs once across N replicas
 *
 * Code review does not reliably catch these bugs, which is why they are gated.
 */

const base = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test/concurrency'],
  testRegex: '\\.concurrency-spec\\.ts$',
  testTimeout: 120_000,
  maxWorkers: 1,
  collectCoverage: false,
};
