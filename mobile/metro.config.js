const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/**
 * Metro config for a workspace package inside a monorepo.
 *
 * Metro does not resolve workspace packages by default. Without the three settings
 * below, `@medichain/shared-types` and friends fail to resolve — and the error Metro
 * produces is unhelpful, which is why this file carries an explanation.
 *
 *   - `watchFolders` lets Metro see the repository root, so edits to a workspace
 *     package trigger a reload instead of being invisible until a full restart.
 *   - `nodeModulesPaths` gives Metro both the app's and the root's `node_modules`,
 *     which is where npm hoists most dependencies.
 *   - `disableHierarchicalLookup` stops Metro walking further up the tree past the
 *     two directories above. In a monorepo that walk can find a second React from an
 *     unrelated package and produce duplicate-copy errors at runtime.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
