/**
 * Mobile test configuration.
 *
 * ## What runs here
 *
 * The auth flow's *logic* — `src/lib/api/client.ts` and the store it drives — is
 * plain TypeScript over `fetch`, so it runs in Node against a real API. That is the
 * part the Phase 0 exit criterion is about, and the part a device is not needed to
 * prove. What a device *would* add is the rendered UI and the real Keychain, and
 * neither is available headless; the suite's `test/support/expo-secure-store.ts`
 * stands in for the platform's secure storage (see that file for what that does and
 * does not cover).
 *
 * ## Why `module: commonjs`
 *
 * The app compiles to `esnext`/`bundler` for Metro, which cannot be `require`d by
 * Jest. `tsconfig.test.json` overrides the module system for the test run only, so
 * the app's own tsconfig stays what Metro expects.
 */

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  roots: ['<rootDir>/test'],
  // `\.spec\.ts$` does not match `foo.integration-spec.ts` — the separator is a
  // hyphen and the pattern requires a dot (the same trap `backend/jest.all.config.js`
  // documents). Listed explicitly rather than loosened.
  testRegex: '\\.(spec|integration-spec)\\.ts$',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      // `isolatedModules` transpiles without emitting types; `tsc -p
      // tsconfig.test.json` is what typechecks this code, in the same
      // `typecheck` script the app already runs.
      { tsconfig: '<rootDir>/tsconfig.test.json', isolatedModules: true },
    ],
  },
  moduleNameMapper: {
    // A native module no Node process can load. See the file for the boundary.
    '^expo-secure-store$': '<rootDir>/test/support/expo-secure-store.ts',
  },
  clearMocks: true,
  // These tests talk to a real API over HTTP and run argon2 hashing at both ends;
  // the default 5s is not enough for a register + login round trip.
  testTimeout: 30_000,
};
