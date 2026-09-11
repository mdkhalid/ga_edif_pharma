/**
 * Base Jest configuration.
 *
 * Unit tests only. Integration, concurrency and isolation suites have their own
 * configs because they need real infrastructure (Testcontainers) and different
 * timeouts — see jest.integration.config.js and friends.
 */

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  clearMocks: true,
  // A flaky test is treated as a failure, so give up rather than hang.
  testTimeout: 15_000,
};
