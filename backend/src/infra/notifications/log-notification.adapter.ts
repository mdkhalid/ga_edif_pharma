import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationPort,
  OrderPlacedNotice,
  OtpDelivery,
} from '../../common/ports/notification.port';

/**
 * Development OTP transport: writes the code to the structured log.
 *
 * Phase 0 has no email or SMS provider wired. Rather than leave the verification
 * and password-reset flows returning a code the caller can never receive, this
 * adapter logs it — which is enough to drive the flow locally and in tests, and
 * is exactly what MailHog/the console SMS provider do for the other channels.
 *
 * It is safe only because it cannot be reached in production: a logging transport
 * publishes every one-time code to the log pipeline, which is a complete account
 * takeover for anyone who can read it. The real transports (`SMTP_*`,
 * `SMS_PROVIDER`) replace this in Phase 1, and the env schema refuses the console
 * SMS provider in production for the same reason.
 */
@Injectable()
export class LogNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(LogNotificationAdapter.name);

  async sendOtp(delivery: OtpDelivery): Promise<void> {
    this.logger.log(
      `OTP for ${delivery.destination} (${delivery.purpose}): ${delivery.code} — ` +
        `valid for ${delivery.expiresInMinutes} minute(s). ` +
        'No email/SMS transport is configured; the code is logged only.',
    );
  }

  async sendOrderPlaced(notice: OrderPlacedNotice): Promise<void> {
    // Logged, not sent — same dev-only rationale as sendOtp. The real
    // SMTP/SMS adapters implement this same method; callers do not change.
    if (notice.email) {
      this.logger.log(
        `Order-placed email to ${notice.email}: ${notice.emailSubject} — ${notice.emailBody}`,
      );
    }
    if (notice.phone) {
      this.logger.log(`Order-placed SMS to ${notice.phone}: ${notice.smsBody}`);
    }
    if (!notice.email && !notice.phone) {
      this.logger.warn(
        `Order ${notice.orderId} placed but the organisation has no email or phone; notice dropped.`,
      );
    }
  }
}
