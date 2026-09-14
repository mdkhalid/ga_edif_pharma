import type { NextConfig } from 'next';

/**
 * Website build configuration.
 *
 * `standalone` output is what the Dockerfile ships: Next traces the exact module
 * graph a route needs and emits a self-contained server, so the runtime image does
 * not carry the whole workspace `node_modules`.
 *
 * `transpilePackages` is required for the workspace libraries. They are published
 * as compiled CommonJS, and letting Next compile them alongside the app keeps a
 * single React copy and a single JSX runtime in the bundle; without it a workspace
 * package can resolve a second React from the root `node_modules` and hooks fail
 * at runtime with the "invalid hook call" error.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@medichain/ui',
    '@medichain/api-client',
    '@medichain/shared-types',
    '@medichain/shared-utils',
  ],
  // Linting is a separate, explicit step (`npm run lint`). Next 16 removed the
  // `eslint` config key and the `next lint` command entirely, so there is nothing
  // to configure here — `eslint.config.mjs` is picked up by ESLint directly, and CI
  // runs both the lint and the build.
};

export default nextConfig;
