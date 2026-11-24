import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { NotificationCentreService } from '../application/notification-centre.service';
import { PushTokenService } from '../application/push-token.service';
import { ListNotificationsQueryDto, RegisterPushTokenDto, UnregisterPushTokenDto } from './dto/notification.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationCentreController {
  constructor(
    private readonly centre: NotificationCentreService,
    private readonly pushTokens: PushTokenService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List in-app notifications for the current user' })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<unknown> {
    return this.centre.list(tenantId, principal.userId, query);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<void> {
    await this.centre.markRead(tenantId, id, principal.userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<{ data: { count: number } }> {
    const result = await this.centre.markAllRead(tenantId, principal.userId);
    return { data: result };
  }

  @Post('push-tokens')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a device push token' })
  async registerPushToken(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<{ data: { id: string } }> {
    const result = await this.pushTokens.register(tenantId, principal.userId, dto);
    return { data: result };
  }

  @Delete('push-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister a device push token' })
  async unregisterPushToken(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UnregisterPushTokenDto,
  ): Promise<void> {
    await this.pushTokens.unregister(tenantId, principal.userId, dto.token);
  }
}
