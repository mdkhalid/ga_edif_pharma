/**
 * Public API of the `audit` module.
 *
 * Everything an audit_log writer needs, and nothing else. `AuditService` is
 * exported because recording an audit event is the one thing other modules
 * legitimately need from here — the append-only store itself stays private.
 *
 * Imports from outside this module must go through this file. The rule is
 * enforced by `scripts/check-module-boundaries.mjs` in CI.
 */

export { AuditModule } from './audit.module';
export { AuditService } from './application/audit.service';
export type { AuditEntry } from './application/audit.service';
