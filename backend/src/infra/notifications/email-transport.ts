import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { AppConfigService } from '../../config/app-config.service';

/**
 * Email delivery.
 *
 * A two-method interface sitting under `NotificationPort`, so the adapter that
 * decides *what* to send (email vs SMS, which channel, what to do when one
 * fails) is testable without a mail server, and this class is the only thing
 * that knows SMTP exists.
 */

export interface OutboundEmail {
  readonly to: string;
  /** Already rendered. The transport never composes wording. */
  readonly subject: string;
  readonly body: string;
}

export interface EmailTransport {
  /** Resolves once the server has accepted the message for delivery. */
  send(message: OutboundEmail): Promise<void>;
}

/**
 * The transport used when no SMTP host is configured.
 *
 * Without it, a development machine with no mail catcher would fail every
 * verification and password-reset request, and the flow would be undriveable
 * locally. It is selected only when `SMTP_HOST` is explicitly empty, so the
 * fallback cannot be reached by accident in a real environment — and the env
 * schema's `AUTH_EXPOSE_OTP_IN_RESPONSE` guard is the supported way to see codes
 * rather than reading the log.
 */
@Injectable()
export class LogEmailTransport implements EmailTransport {
  private readonly logger = new Logger(LogEmailTransport.name);

  async send(message: OutboundEmail): Promise<void> {
    this.logger.log(
      `Email to ${message.to}: ${message.subject} — ${message.body} ` +
        '(no SMTP host is configured; the message was logged, not sent).',
    );
  }
}

/**
 * SMTP transport.
 *
 * ## Authentication is conditional, deliberately
 *
 * A server with no `SMTP_USER` gets no `auth` block at all rather than an empty
 * one. Local catchers (Mailhog, Mailpit) accept unauthenticated submission, and
 * nodemailer treats a present-but-empty `auth` as an attempt to authenticate
 * with blank credentials — which such a server rejects.
 *
 * ## What this does not do
 *
 * Nothing here retries. `sendMail` resolving means the server accepted the
 * message, which is the strongest guarantee SMTP offers synchronously; a
 * durable retry has to be driven by the outbox relay, because a retry loop
 * inside a request would either outlive the request or lose the message when
 * the process exits.
 */
@Injectable()
export class SmtpEmailTransport implements EmailTransport {
  private readonly logger = new Logger(SmtpEmailTransport.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: AppConfigService) {
    const smtp = config.notifications.smtp;
    this.from = smtp.from;

    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      ...(smtp.user === '' ? {} : { auth: { user: smtp.user, pass: smtp.password } }),
    });
  }

  async send(message: OutboundEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      // `text`, not `html`: the templates render plain text, and a plain-text
      // body cannot carry an injected tag into a mail client.
      text: message.body,
    });

    this.logger.debug(`Email accepted by the SMTP server for ${message.to}.`);
  }
}
