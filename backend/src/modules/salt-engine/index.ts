/**
 * Public API of the `salt-engine` module.
 *
 * The module for Nest wiring and the service for the `search` module, which
 * consumes it through this barrel (enforced by
 * `scripts/check-module-boundaries.mjs`).
 */

export { SaltEngineModule } from './salt-engine.module';
export { SaltEngineService } from './application/salt-engine.service';
