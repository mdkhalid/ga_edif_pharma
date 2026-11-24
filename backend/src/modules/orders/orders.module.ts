import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit';
import { NotificationsModule } from '../notifications';
import { OutboxModule } from '../outbox';
import { PrescriptionsModule } from '../prescriptions';
import { OrderController } from './api/order.controller';
import { OrderService } from './application/order.service';

/**
 * Orders bounded context. Reached through `./index`, never by deep import.
 */
@Module({
  imports: [DatabaseModule, AuditModule, NotificationsModule, OutboxModule, PrescriptionsModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}
