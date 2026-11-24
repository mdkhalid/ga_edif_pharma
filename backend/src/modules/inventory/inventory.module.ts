import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { StockQueryService } from './application/stock-query.service';
import { StockController } from './api/stock.controller';

/**
 * Inventory bounded context.
 *
 * The domain layer (immutable `StockLedger`, FEFO allocation) was already here;
 * this module adds the read side an operator needs. It is intentionally query-only:
 * stock levels change through order reservation and adjustment flows, never
 * through a generic admin edit of a quantity column.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [StockController],
  providers: [StockQueryService],
  exports: [StockQueryService],
})
export class InventoryModule {}
