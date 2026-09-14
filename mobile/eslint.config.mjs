import sharedBase from '@medichain/config/eslint/base.cjs';

/**
 * ESLint flat config for the mobile app.
 *
 * The shared base only. `eslint-config-expo` and the React Native plugin are
 * deliberately not wired up yet: they pull in a parser and a plugin set that
 * duplicate what the TypeScript compiler already checks here, and the app's own lint
 * signal during the skeleton phase is TypeScript. Adding them is a Phase 1 task.
 */
const config = [
  ...sharedBase,
  {
    ignores: ['.expo/**', 'node_modules/**', 'dist/**', 'app.json'],
  },
];

export default config;
