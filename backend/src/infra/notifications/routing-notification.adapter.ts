import { Injectable, Logger } from '@nestjs/common';

import type { OtpPurpose } from '@medichain/shared-types';

import {
  type NotificationPort,
  type OrderPlacedNotice,
  type OtpDelivery,
} from '../../common/ports/notification.port';
import { AppConfigService } from '../../config/app-config.service';
import type { EmailTransport } from './email-transport';
import type { SmsTransport } from './sms-transport';

/**
 * The `NotificationPort` implementation that is actually bound.
 *
 * It owns routing — which channel a message goes to, and what happens when one
 * channel fails — and delegates transport to the two interfaces beside it. That
 * split is what makes the interesting behaviour testable without a mail server
 * or an SMS provider: the routing rules are pure decisions over injected
 * transports.
 *
 * ## Delivery policy
 *
 * `sendOrderPlaced` is best-effort by contract. The two channels are attempted
 * **independently** and their failures are logged, never thrown: an SMS provider
 * outage must not stop the email, and neither must fail the order. `sendOtp` is
 * the opposite on purpose — see below.
 */

/** Conservative: the port may be handed an email or a phone number. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OTP_PURPOSE_LABEL: Readonly<Record<OtpPurpose, string>> = {
  LOGIN: 'sign-in',
  REGISTER: 'registration',
  RESET_PASSWORD: 'password reset',
  VERIFY_CONTACT: 'verification',
};

@Injectable()
export class RoutingNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(RoutingNotificationAdapter.name);

  constructor(
    private readonly email: EmailTransport,
    private readonly sms: SmsTransport,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Delivers a one-time code over whichever channel the destination implies.
   *
   * Unlike an order notice, this **throws** when the transport fails. The code
   * is the only way to finish the flow, and a caller that reported "code sent"
   * while the send failed would leave the user waiting for a message that is
   * never coming. Returning the failure lets the request fail honestly.
   *
   * It does not throw for a destination that is neither an email nor a phone
   * number — there is nothing to deliver to, and the port's contract is explicit
   * that an unknown destination is not an error.
   */
  async sendOtp(delivery: OtpDelivery): Promise<void> {
    const label = OTP_PURPOSE_LABEL[delivery.purpose];
    const body =
      `${delivery.code} is your ${this.config.appName} ${label} code. ` +
      `It expires in ${delivery.expiresInMinutes} minute(s).`;

    if (EMAIL_PATTERN.test(delivery.destination)) {
      await this.email.send({
        to: delivery.destination,
        subject: `${delivery.code} is your ${label} code`,
        body,
      });
      return;
    }

    if (delivery.destination.trim() === '') {
      this.logger.warn(`A ${label} code had no destination and was not delivered.`);
      return;
    }

    await this.sms.send({ to: delivery.destination, body });
  }

  /**
   * Delivers an order-placed notice by email and SMS.
   *
   * Both channels are attempted even when the first fails, which is the whole
   * reason this uses `allSettled` rather than awaiting in sequence: an email
   * outage should not silently cost the SMS as well.
   */
  async sendOrderPlaced(notice: OrderPlacedNotice): Promise<void> {
    const attempts: Array<{ channel: string; send: Promise<void> }> = [];

    if (notice.email !== null && notice.email !== '') {
      attempts.push({
        channel: 'email',
        send: this.email.send({
          to: notice.email,
          subject: notice.emailSubject,
          body: notice.emailBody,
        }),
      });
    }

    if (notice.phone !== null && notice.phone !== '') {
      attempts.push({
        channel: 'sms',
        send: this.sms.send({ to: notice.phone, body: notice.smsBody }),
      });
    }

    if (attempts.length === 0) {
      this.logger.warn(
        `Order ${notice.orderId} was placed but its organisation has no email or phone; ` +
          'no notice was sent.',
      );
      return;
    }

    const results = await Promise.allSettled(attempts.map((attempt) => attempt.send));

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const channel = attempts[index]?.channel ?? 'unknown';
        this.logger.error(
          `Order ${notice.orderId}: the ${channel} notice failed and will not be retried ` +
            `until the outbox relay exists — ` +
            `${result.reason instanceof Error ? result.reason.message : 'unknown error'}`,
        );
      }
    });
  }
}
