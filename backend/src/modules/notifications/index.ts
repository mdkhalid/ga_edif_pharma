/**
 * Public API of the `notifications` module.
 *
 * The module for Nest wiring, the service for use cases that notify, and
 * the port token for infrastructure. Imports from outside must go through
 * this file (enforced by `scripts/check-module-boundaries.mjs`).
 */

export { NotificationsModule } from './notifications.module';
export { NotificationService } from './application/notification.service';
export { NotificationCentreService } from './application/notification-centre.service';
export { NotificationDispatcherService } from './application/notification-dispatcher.service';
export { NotificationPreferenceService } from './application/notification-preference.service';
export { NotificationTemplateService } from './application/notification-template.service';
export { PushTokenService } from './application/push-token.service';
export { PUSH_TRANSPORT } from '../../common/ports/push.port';
export type { PushTransport, PushMessage } from '../../common/ports/push.port';
export { NOTIFICATION_PORT } from '../../common/ports/notification.port';
