/**
 * ESLint configuration (legacy .eslintrc format, ESLint 8).
 *
 * Note on the module-boundary rule: enforcing "a module may only be imported
 * through its index.ts" correctly requires path *zones* (eslint-plugin-import's
 * `no-restricted-paths`), because `no-restricted-imports` cannot distinguish
 * "importing my own infrastructure" from "importing another module's". The rule
 * is included below, disabled, with the exact reason — shipping a rule that
 * produces false positives trains people to ignore lint output.
 */

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // Both projects, deliberately. `tsconfig.json` is the production build
    // config and excludes `test/**` so that production code cannot reference
    // Jest globals. Lint still has to cover the tests, so they resolve against
    // `tsconfig.test.json` instead. A single project here would either fail to
    // parse the specs or re-expose the Jest globals to `src`.
    project: ['./tsconfig.json', './tsconfig.test.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    jest: true,
  },
  rules: {
    // `any` in application code is a hole in the type system at exactly the
    // point the compiler was supposed to help. Enforced, not advisory.
    '@typescript-eslint/no-explicit-any': 'error',

    // An un-awaited promise on a money path is a silent correctness bug.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',

    // Money arithmetic must go through the Money value object, never raw operators.
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',

    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      { allowExpressions: true, allowTypedFunctionExpressions: true },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',

    // Enabled once eslint-plugin-import is added:
    // 'import/no-restricted-paths': ['error', {
    //   zones: [{ target: './src/modules', from: './src/modules', except: ['./<module>/index.ts'] }],
    // }],

    'no-restricted-syntax': [
      'error',
      {
        // Guards against the NestJS ValidationPipe trap: an interface in a DTO
        // position erases at runtime, so validation silently does not run.
        selector:
          "PropertyDefinition[decorators.0.expression.callee.name='Body'] > TSTypeReference[typeName.name=/^I[A-Z]/]",
        message:
          'DTOs must be decorated classes, not interfaces — an interface makes the ValidationPipe a silent no-op.',
      },
    ],
  },
  ignorePatterns: ['.eslintrc.cjs', 'jest*.config.js', 'dist', 'node_modules', 'coverage'],
};
