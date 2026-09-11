/**
 * End-to-end tests — full HTTP flows against a booted Nest application.
 */

const base = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test/e2e'],
  testRegex: '\\.e2e-spec\\.ts$',
  testTimeout: 60_000,
  maxWorkers: 1,
  collectCoverage: false,
};
