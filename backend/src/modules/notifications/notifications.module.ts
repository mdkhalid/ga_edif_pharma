import { Logger, Module } from '@nestjs/common';

import { NOTIFICATION_PORT } from '../../common/ports/notification.port';
import { AppConfigService } from '../../config/app-config.service';
import {
  LogEmailTransport,
  SmtpEmailTransport,
  type EmailTransport,
} from '../../infra/notifications/email-transport';
import { RoutingNotificationAdapter } from '../../infra/notifications/routing-notification.adapter';
import {
  ConsoleSmsTransport,
  Msg91SmsTransport,
  TwilioSmsTransport,
  type SmsTransport,
} from '../../infra/notifications/sms-transport';
import { PUSH_TRANSPORT } from '../../common/ports/push.port';
import { buildPushTransport } from '../../infra/notifications/push-transport';
import { NotificationCentreService } from './application/notification-centre.service';
import { NotificationDispatcherService } from './application/notification-dispatcher.service';
import { NotificationPreferenceService } from './application/notification-preference.service';
import { NotificationTemplateService } from './application/notification-template.service';
import { NotificationService } from './application/notification.service';
import { PushTokenService } from './application/push-token.service';
import { NotificationCentreController } from './api/notification-centre.controller';
import { NotificationPreferenceController } from './api/notification-preference.controller';
import { NotificationTemplateController } from './api/notification-template.controller';

/**
 * Notifications bounded context.
 *
 * Owns the `NOTIFICATION_PORT` binding and the application-level notification
 * service. Both transports are chosen here, from configuration, so that is the
 * only file that changes when a provider is added or swapped. Reached through
 * `./index`, never by deep import.
 *
 * ## Why the transport is selected at boot rather than per message
 *
 * A provider that is wrong is wrong for every message, and the class of bug
 * worth preventing is "we thought email was going out and it was not". Deciding
 * once, at startup, and logging the decision, makes that answerable from the
 * boot log rather than by inference — and removes any path where one message
 * takes a different route from its neighbours.
 */

const logger = new Logger('NotificationsModule');

/** The email transport for the current configuration. */
function buildEmailTransport(config: AppConfigService): EmailTransport {
  // `SMTP_HOST` empty is the explicit "no SMTP" signal. See the env schema.
  return config.notifications.smtp.host === ''
    ? new LogEmailTransport()
    : new SmtpEmailTransport(config);
}

/** The SMS transport for the current configuration. */
function buildSmsTransport(config: AppConfigService): SmsTransport {
  switch (config.notifications.sms.provider) {
    case 'msg91':
      return new Msg91SmsTransport(config);
    case 'twilio':
      return new TwilioSmsTransport(config);
    case 'console':
      return new ConsoleSmsTransport();
  }
}

@Module({
  controllers: [
    NotificationCentreController,
    NotificationPreferenceController,
    NotificationTemplateController,
  ],
  providers: [
    NotificationService,
    NotificationCentreService,
    NotificationDispatcherService,
    NotificationPreferenceService,
    NotificationTemplateService,
    PushTokenService,
    { provide: PUSH_TRANSPORT, useFactory: (config: AppConfigService) => buildPushTransport(config), inject: [AppConfigService] },
    {
      provide: NOTIFICATION_PORT,
      useFactory: (config: AppConfigService) => {
        const email = buildEmailTransport(config);
        const sms = buildSmsTransport(config);

        // Logged, not just decided: "is email actually leaving this
        // deployment?" is a question someone asks during an incident.
        logger.log(
          `Outbound notifications: email via ${
            email instanceof SmtpEmailTransport
              ? `SMTP (${config.notifications.smtp.host}:${config.notifications.smtp.port})`
              : 'the log (SMTP_HOST is empty)'
          }, SMS via ${config.notifications.sms.provider}.`,
        );

        return new RoutingNotificationAdapter(email, sms, config);
      },
      inject: [AppConfigService],
    },
  ],
  exports: [
    NotificationService,
    NotificationCentreService,
    NotificationDispatcherService,
    NotificationPreferenceService,
    NotificationTemplateService,
    PushTokenService,
    NOTIFICATION_PORT,
  ],
})
export class NotificationsModule {}
