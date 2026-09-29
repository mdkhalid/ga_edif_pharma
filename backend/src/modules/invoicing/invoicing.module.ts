import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { InvoicingService } from './application/invoicing.service';
import { InvoiceController } from './api/invoice.controller';

/**
 * Invoicing bounded context (P7).
 *
 * The GST-safe core lives in `domain/` (pure, tested without a database). This
 * module binds the application service — which issues gapless-numbered invoices
 * against orders inside one transaction — and the HTTP surface. Exported for the
 * fulfilment flows (dispatch, returns, credit notes) that will consume it next.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [InvoiceController],
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class InvoicingModule {}
