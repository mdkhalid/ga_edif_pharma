/**
 * Tenant isolation tests. BLOCKING on every PR.
 *
 * Asserts that no principal can read or mutate another tenant's data, through
 * any route: direct id access, list endpoints, filter parameters, or a forged
 * tenant claim in the JWT.
 *
 * A resource belonging to another tenant must return 404, never 403 — a 403
 * confirms the resource exists, which is an information leak.
 *
 * A single missing `tenant_id` filter is a data breach, and code review does
 * not reliably catch it. Hence the automated gate.
 */

const base = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test/isolation'],
  testRegex: '\\.isolation-spec\\.ts$',
  testTimeout: 60_000,
  maxWorkers: 1,
  collectCoverage: false,
};
