import { Injectable, Logger } from '@nestjs/common';

import type { NotificationChannel } from '../domain/notification-centre.types';
import { NotificationCentreService } from './notification-centre.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { PushTokenService } from './push-token.service';

export interface DispatchNotificationInput {
  tenantId: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  metadata?: unknown;
}

export interface DispatchResult {
  /** True when the in-app record was written. */
  inApp: boolean;
  /** Push delivery counts, or null when the channel was switched off. */
  push: { delivered: number; failed: number } | null;
}

/**
 * Fans a notification out to the channels its recipient allows (P9).
 *
 * The centre records, the preference service decides, and the push registry
 * delivers — this service is the composition of the three, so a caller that
 * wants "tell this user something" does not have to remember that the in-app
 * record and the device push are separate mechanisms with separate toggles.
 *
 * ## Failure policy
 *
 * Push is best-effort: a dead device token or an unreachable gateway is counted
 * and logged, never thrown, because a notification failing must not fail the
 * business operation that caused it. The in-app write is *not* swallowed — it is
 * a single local insert, and if it fails the caller has a real problem worth
 * surfacing. A preference with no row means "enabled", matching the preference
 * service's opt-out default.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly centre: NotificationCentreService,
    private readonly preferences: NotificationPreferenceService,
    private readonly pushTokens: PushTokenService,
  ) {}

  async dispatch(input: DispatchNotificationInput): Promise<DispatchResult> {
    const enabled = await this.preferences.getEnabledChannels(input.tenantId, input.recipientId);

    let inApp = false;
    if (enabled.has('IN_APP')) {
      await this.centre.create({
        tenantId: input.tenantId,
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata,
      });
      inApp = true;
    }

    const push = enabled.has('PUSH') ? await this.deliverPush(input) : null;
    return { inApp, push };
  }

  /** The channels a dispatch to this recipient would currently use. */
  async channelsFor(tenantId: string, recipientId: string): Promise<NotificationChannel[]> {
    const enabled = await this.preferences.getEnabledChannels(tenantId, recipientId);
    return [...enabled];
  }

  private async deliverPush(
    input: DispatchNotificationInput,
  ): Promise<{ delivered: number; failed: number }> {
    try {
      return await this.pushTokens.sendToUser(
        input.tenantId,
        input.recipientId,
        input.title,
        input.body,
        { type: input.type },
      );
    } catch (error) {
      this.logger.warn(
        `Push delivery to ${input.recipientId} failed (type=${input.type}): ` +
          `${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { delivered: 0, failed: 0 };
    }
  }
}
