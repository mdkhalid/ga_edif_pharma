/**
 * Jest configuration for @medichain/shared-utils.
 *
 * This package is consumed by the backend, both Next.js apps and React Native,
 * so its tests run in the plainest possible environment: no jsdom, no
 * `testEnvironment: node` extras, no globals beyond Jest's own. If a test here
 * needs a browser or Node API, the code under test has broken the package's
 * "no Node built-ins, no DOM" rule — which is a real constraint, because Hermes
 * provides neither.
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
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  // These two modules encode money and medicine-identity rules. A branch that is
  // not covered here is a branch whose behaviour nobody has decided on.
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  clearMocks: true,
  verbose: false,
};
