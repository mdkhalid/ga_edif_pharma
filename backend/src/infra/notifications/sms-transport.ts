import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';

/**
 * SMS delivery.
 *
 * Same shape as the email transport: a one-method interface the routing adapter
 * depends on, and one class per provider. All three talk over plain `fetch` —
 * neither provider's REST API needs an SDK, and a vendor SDK would be a
 * dependency that has to be vetted and kept current for what amounts to one
 * HTTP request.
 */

export interface OutboundSms {
  /** E.164. Both providers reject anything else. */
  readonly to: string;
  readonly body: string;
}

export interface SmsTransport {
  /** Resolves once the provider has accepted the message. */
  send(message: OutboundSms): Promise<void>;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Development default: writes the message to the log.
 *
 * The env schema refuses this provider in production, because a logging
 * transport publishes every one-time code to the log pipeline.
 */
@Injectable()
export class ConsoleSmsTransport implements SmsTransport {
  private readonly logger = new Logger(ConsoleSmsTransport.name);

  async send(message: OutboundSms): Promise<void> {
    this.logger.log(
      `SMS to ${message.to}: ${message.body} ` +
        '(no SMS provider is configured; the message was logged, not sent).',
    );
  }
}

/**
 * MSG91, via the `sendhttp` endpoint.
 *
 * A GET with query parameters rather than a JSON body — that is the shape of
 * this endpoint, and it is why the message has to be URL-encoded by
 * `URLSearchParams` rather than interpolated into a template string.
 */
@Injectable()
export class Msg91SmsTransport implements SmsTransport {
  private readonly logger = new Logger(Msg91SmsTransport.name);

  constructor(private readonly config: AppConfigService) {}

  async send(message: OutboundSms): Promise<void> {
    const sms = this.config.notifications.sms;
    const senderId = sms.senderId;

    const url = new URL('https://api.msg91.com/api/sendhttp.php');
    url.searchParams.set('authkey', sms.apiKey);
    url.searchParams.set('mobiles', message.to);
    url.searchParams.set('message', message.body);
    url.searchParams.set('sender', senderId);
    url.searchParams.set('route', '4');
    url.searchParams.set('country', '91');

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The URL carries the auth key, so it is deliberately absent from the
      // error: this message reaches logs and error trackers.
      throw new Error(`MSG91 rejected the message (HTTP ${response.status}).`);
    }

    this.logger.debug(`SMS accepted by MSG91 for ${message.to}.`);
  }
}

/** Twilio, via the Messages resource. HTTP Basic auth, form-encoded body. */
@Injectable()
export class TwilioSmsTransport implements SmsTransport {
  private readonly logger = new Logger(TwilioSmsTransport.name);

  constructor(private readonly config: AppConfigService) {}

  async send(message: OutboundSms): Promise<void> {
    const sms = this.config.notifications.sms;
    const accountSid = sms.twilioAccountSid;
    const from = sms.senderId;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${sms.apiKey}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: message.to, From: from, Body: message.body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Twilio rejected the message (HTTP ${response.status}).`);
    }

    this.logger.debug(`SMS accepted by Twilio for ${message.to}.`);
  }
}
