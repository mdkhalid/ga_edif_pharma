import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { CreditQueryService } from './application/credit-query.service';
import { CreditController } from './api/credit.controller';

/**
 * Credit bounded context.
 *
 * The domain has an immutable `CreditLedger`, but no ledger table is persisted
 * yet; this module exposes the organisation's authoritative limit and exposure
 * columns as a read-only viewer. Adding the ledger table later changes the
 * service's source, not the controller's contract.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [CreditController],
  providers: [CreditQueryService],
  exports: [CreditQueryService],
})
export class CreditModule {}
