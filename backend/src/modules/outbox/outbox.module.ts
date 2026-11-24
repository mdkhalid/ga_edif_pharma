import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications';
import { OutboxService } from './application/outbox.service';

/**
 * Transactional outbox + relay (P10).
 *
 * `OutboxService.enqueue` is called inside business transactions to record
 * an event that the relay then publishes with retry + dead-lettering. The
 * relay runs on an interval unless `NODE_ENV=test`, so tests drive
 * `processBatch()` directly.
 */
@Module({
  imports: [DatabaseModule, NotificationsModule],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
