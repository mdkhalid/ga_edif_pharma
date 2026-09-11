/**
 * Public API of the `iam` module.
 *
 * Only the Nest module class is exported. The auth services, guards and value
 * objects stay private: the platform's identity rules should be reached over
 * HTTP or through the ports in `src/common/ports`, never by another module
 * importing `AuthService` directly. Widening this file is an architectural
 * decision, not a convenience.
 *
 * Imports from outside this module must go through this file. The rule is
 * enforced by `scripts/check-module-boundaries.mjs` in CI.
 */

export { IamModule } from './iam.module';
