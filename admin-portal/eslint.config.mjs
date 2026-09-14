import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

import sharedBase from '@medichain/config/eslint/base.cjs';

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
