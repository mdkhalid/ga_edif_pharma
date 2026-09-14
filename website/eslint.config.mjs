import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

import sharedBase from '@medichain/config/eslint/base.cjs';

/**
 * ESLint flat config.
 *
 * The two `eslint-config-next` presets cover the framework rules (including the
 * React hooks rules that catch the majority of real bugs), and the shared base adds
 * the repository-wide policy. Normalising each to an array means a preset that
 * exports a single config object rather than an array does not break the spread.
 */
const asArray = (value) => (Array.isArray(value) ? value : [value]);

const config = [
  ...asArray(nextVitals),
  ...asArray(nextTypescript),
  ...asArray(sharedBase),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'next.config.ts'],
  },
];

export default config;
