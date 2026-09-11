import { SetMetadata } from '@nestjs/common';

import { META } from '../constants/metadata';

/**
 * Opts a route out of automatic tenant scoping.
 *
 * This is the escape hatch described in `request-context.ts`, and it is
 * deliberately loud. Legitimate uses:
 *
 *   - `POST /auth/login` — the tenant is not known until credentials resolve,
 *   - platform settings read by the super-admin,
 *   - health checks and metrics.
 *
 * It must NEVER appear on a route that returns tenant-owned business data. If
 * you are reaching for it because a query "returns nothing", the correct fix is
 * to set the tenant on the context, not to bypass the scope.
 */
export const SkipTenantScope = () => SetMetadata(META.SKIP_TENANT_SCOPE, true);

export interface AuditOptions {
  /** Machine-readable action, e.g. `order.approve`. Stored verbatim. */
  readonly action: string;
  /** Entity type the action applies to, e.g. `Order`. */
  readonly entity?: string;
  /**
   * Record the request body in the audit row.
   *
   * Off by default. Bodies routinely contain passwords, tokens and patient
   * identifiers; the audit log is append-only and widely readable, so it must
   * not become a secondary copy of sensitive data.
   */
  readonly captureBody?: boolean;
}

/**
 * Records an audit row when the handler succeeds.
 *
 * The write happens in the same transaction as the business change wherever
 * possible (see `AuditService.recordInTransaction`). An audit entry written on
 * a separate connection can survive a rolled-back mutation, or be lost when a
 * committed one succeeds — both make the log worthless as evidence.
 */
export const Audit = (options: AuditOptions) => SetMetadata(META.AUDIT, options);

/**
 * Returns the handler's value verbatim instead of wrapping it in `{ data }`.
 *
 * For file downloads and third-party webhook acknowledgements, where the
 * response shape is dictated by an external contract.
 */
export const RawResponse = () => SetMetadata(META.RAW_RESPONSE, true);
