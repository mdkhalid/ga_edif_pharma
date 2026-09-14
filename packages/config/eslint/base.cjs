/**
 * Shared ESLint base for the web and mobile applications.
 *
 * Flat-config shape (an array), because ESLint 9 is the major used by the client
 * apps and flat config is its default. The backend still uses ESLint 8 with
 * `.eslintrc.cjs` and its own type-aware rules, so it does not extend this file.
 *
 * Deliberately free of `plugins` and `parser`: a framework config
 * (`eslint-config-next`, `expo`) already supplies the TypeScript parser and the
 * React rules, and a base that declared them too would fight over the parser.
 * What lives here is only the framework-independent policy, so any app can spread
 * it without needing a plugin that may not be installed.
 */
module.exports = [
  {
    rules: {
      // `==` against `null` is a deliberate idiom that catches null and undefined.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
