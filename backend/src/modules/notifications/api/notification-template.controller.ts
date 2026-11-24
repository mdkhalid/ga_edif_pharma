import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Capability, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { NotificationTemplateService } from '../application/notification-template.service';
import { UpsertNotificationTemplateDto } from './dto/notification.dto';

/**
 * Tenant-level notification templates.
 *
 * This is the backend the admin portal's template screen will call. Reading
 * needs `SETTINGS_READ` and changing wording needs `SETTINGS_WRITE`, because
 * editing a template changes what every customer in the tenant is told — a
 * support agent with no settings rights should not be able to rewrite the
 * order-placed email.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications/templates')
export class NotificationTemplateController {
  constructor(private readonly templates: NotificationTemplateService) {}

  @Get()
  @RequireCapability(Capability.SETTINGS_READ)
  @ApiOperation({ summary: 'List notification templates' })
  async list(
    @CurrentTenant() tenantId: string,
  ): Promise<{ data: unknown[] }> {
    return { data: await this.templates.list(tenantId) };
  }

  @Put()
  @RequireCapability(Capability.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Create or replace a notification template' })
  async upsert(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpsertNotificationTemplateDto,
  ): Promise<{ data: { id: string; created: boolean } }> {
    const result = await this.templates.upsert(tenantId, principal.userId, {
      name: dto.name,
      channel: dto.channel,
      subject: dto.subject ?? null,
      body: dto.body,
    });
    return { data: result };
  }

  @Delete(':id')
  @RequireCapability(Capability.SETTINGS_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification template' })
  async remove(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<void> {
    await this.templates.remove(tenantId, id, principal.userId);
  }
}
