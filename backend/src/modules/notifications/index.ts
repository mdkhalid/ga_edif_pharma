/**
 * Public API of the `notifications` module.
 *
 * The module for Nest wiring, the service for use cases that notify, and
 * the port token for infrastructure. Imports from outside must go through
 * this file (enforced by `scripts/check-module-boundaries.mjs`).
 */

export { NotificationsModule } from './notifications.module';
export { NotificationService } from './application/notification.service';
export { NOTIFICATION_PORT } from '../../common/ports/notification.port';
