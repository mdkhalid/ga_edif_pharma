/**
 * Barrel for the decorator layer.
 *
 * Import from `@common/decorators` so a decorator can be relocated without
 * touching every controller.
 */

export { Public } from './public.decorator';
export { CurrentUser, OptionalUser, CurrentTenant } from './current-user.decorator';
export {
  RequireCapability,
  RequireAnyCapability,
  RequireRoles,
} from './require-capability.decorator';
export { Idempotent, type IdempotencyOptions } from './idempotent.decorator';
export { RateLimit, type RateLimitOptions } from './rate-limit.decorator';
export {
  SkipTenantScope,
  Audit,
  RawResponse,
  type AuditOptions,
} from './scope-and-audit.decorator';
