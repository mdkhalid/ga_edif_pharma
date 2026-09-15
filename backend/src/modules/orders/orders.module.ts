import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit';
import { NotificationsModule } from '../notifications';
import { OrderController } from './api/order.controller';
import { OrderService } from './application/order.service';

/**
 * Orders bounded context. Reached through `./index`, never by deep import.
 */
@Module({
  imports: [DatabaseModule, AuditModule, NotificationsModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}
