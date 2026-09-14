import type { NextConfig } from 'next';

/**
 * Admin portal build configuration.
 *
 * Same shape as the website's — `standalone` output for the image, and
 * `transpilePackages` so the workspace libraries resolve a single React copy.
 *
 * It is a separate deployable rather than a route group inside the website because
 * its threat model is different: staff-only, deployable to a private subnet behind
 * a VPN or IP allow-list, with a stricter session policy. Sharing a deployment
 * would mean a change to a back-office table could take the buyer-facing catalogue
 * down with it.
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
};

export default nextConfig;
