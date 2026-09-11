/**
 * Public API of the `health` module.
 *
 * Only the Nest module class is exported: health probes are reached over HTTP,
 * never by importing the controller or service from another module.
 *
 * Imports from outside this module must go through this file. The rule is
 * enforced by `scripts/check-module-boundaries.mjs` in CI.
 */

export { HealthModule } from './health.module';
