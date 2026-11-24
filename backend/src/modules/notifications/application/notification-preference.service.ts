import { Inject, Injectable } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import type { NotificationChannel } from '../domain/notification-centre.types';

const DEFAULT_CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];

/**
 * Per-user channel preferences (P9). A missing row means "enabled", so the
 * default is opt-out rather than opt-in — a new user gets every channel until
 * they turn one off.
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async getEnabledChannels(_tenantId: string, userId: string): Promise<Set<NotificationChannel>> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.channel as NotificationChannel));
    const enabled = new Set<NotificationChannel>();
    for (const ch of DEFAULT_CHANNELS) {
      if (!disabled.has(ch)) enabled.add(ch);
    }
    return enabled;
  }

  async setChannel(tenantId: string, userId: string, channel: NotificationChannel, enabled: boolean): Promise<void> {
    const existing = await this.prisma.notificationPreference.findFirst({ where: { userId, channel } });
    if (existing) {
      await this.prisma.notificationPreference.updateMany({
        where: { userId, channel },
        data: { enabled },
      });
    } else {
      await this.prisma.notificationPreference.create({
        data: { tenantId, userId, channel, enabled },
      });
    }
  }
}
