import { Injectable, Logger } from '@nestjs/common';

import type { PushMessage, PushTransport } from '../../common/ports/push.port';
import { AppConfigService } from '../../config/app-config.service';

/**
 * The push transport used when no provider credentials are configured.
 *
 * Like `LogEmailTransport` and `ConsoleSmsTransport`, it makes the absence of a
 * provider observable rather than silent: the message is logged with its target
 * token, so an environment that is supposed to be sending push notifications can
 * be confirmed — or ruled out — from the log alone.
 */
@Injectable()
export class ConsolePushTransport implements PushTransport {
  private readonly logger = new Logger(ConsolePushTransport.name);

  async send(message: PushMessage): Promise<void> {
    this.logger.log(
      `[push] to=${message.token} title="${message.title}" body="${message.body}"`,
    );
  }
}

/**
 * Select the push transport from configuration.
 *
 * Returns the console transport today because no FCM/APNs credentials exist in
 * this deployment. This is the single place a real transport is swapped in —
 * mirroring `email-transport.ts` / `sms-transport.ts`, so the choice stays a boot
 * decision that can be read off the startup log instead of inferred per message.
 */
export function buildPushTransport(_config: AppConfigService): PushTransport {
  return new ConsolePushTransport();
}
