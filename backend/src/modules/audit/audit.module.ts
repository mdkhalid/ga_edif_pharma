import { Global, Module } from '@nestjs/common';

import { AuditService } from './application/audit.service';

/**
 * Audit module.
 *
 * `@Global()` because auditing is a cross-cutting obligation, not an optional
 * feature: any module that mutates state may need to record why. Requiring an
 * explicit import would mean the module that forgot it silently produces no
 * audit trail — and a gap in an audit trail is only discovered during an
 * investigation, which is the worst possible time.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
