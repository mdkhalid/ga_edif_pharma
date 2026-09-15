import { Module } from '@nestjs/common';

import { NOTIFICATION_PORT } from '../../common/ports/notification.port';
import { LogNotificationAdapter } from '../../infra/notifications/log-notification.adapter';
import { NotificationService } from './application/notification.service';

/**
 * Notifications bounded context.
 *
 * Owns the `NOTIFICATION_PORT` binding (previously held by `iam`) and the
 * application-level notification service. Swapping the logging adapter for
 * real SMTP/SMS transports changes only this file. Reached through
 * `./index`, never by deep import.
 */
@Module({
  providers: [
    NotificationService,
    // No email/SMS transport exists yet. The logging adapter makes every
    // notification flow driveable locally; a real adapter drops in here and
    // nothing else changes. See `NotificationPort`.
    { provide: NOTIFICATION_PORT, useClass: LogNotificationAdapter },
  ],
  exports: [NotificationService, NOTIFICATION_PORT],
})
export class NotificationsModule {}
