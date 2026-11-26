/**
 * Jest configuration for @medichain/api-client.
 *
 * Jest and ts-jest are already installed in this npm workspace by the backend,
 * mobile app and shared-utils, so no new dependency is needed here (and the
 * sandbox's npm cleanup is unreliable). These tests run in Node against an
 * injected fetch — no API, database or browser is required.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // The generated schema is machine-written and verified by the contract
  // drift check in CI; measuring coverage on it would be meaningless.
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
  verbose: false,
};
