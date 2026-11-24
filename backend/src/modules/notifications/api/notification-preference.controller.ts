import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal, NotificationPreferenceState } from '@medichain/shared-types';

import { CurrentTenant, CurrentUser } from '../../../common/decorators';
import { ValidationFailedError } from '../../../common/exceptions/domain.exception';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from '../domain/notification-centre.types';import { NotificationPreferenceService } from '../application/notification-preference.service';
import { SetChannelPreferenceDto } from './dto/notification.dto';

/**
 * A user's own notification channel preferences.
 *
 * Deliberately scoped to the caller: there is no `:userId` in the route, because
 * changing another person's delivery settings is not an administrative act in
 * this product — it is a way to silence someone else's alerts.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications/preferences')
export class NotificationPreferenceController {
  constructor(private readonly preferences: NotificationPreferenceService) {}

  @Get()
  @ApiOperation({ summary: 'List the channels enabled for the current user' })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<{ data: NotificationPreferenceState }> {
    const enabled = await this.preferences.getEnabledChannels(tenantId, principal.userId);
    return {
      data: { enabled: [...enabled], available: [...NOTIFICATION_CHANNELS] },
    };
  }

  @Patch(':channel')
  @ApiOperation({ summary: 'Enable or disable a channel for the current user' })
  async setChannel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('channel') channel: string,
    @Body() dto: SetChannelPreferenceDto,
  ): Promise<{ data: { channel: NotificationChannel; enabled: boolean } }> {
    const normalised = channel.toUpperCase() as NotificationChannel;
    if (!NOTIFICATION_CHANNELS.includes(normalised)) {
      throw new ValidationFailedError(
        `Unknown notification channel "${channel}". Expected one of ${NOTIFICATION_CHANNELS.join(', ')}.`,
      );
    }

    await this.preferences.setChannel(tenantId, principal.userId, normalised, dto.enabled);
    return { data: { channel: normalised, enabled: dto.enabled } };
  }
}
