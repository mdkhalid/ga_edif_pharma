import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  Capability,
  type AuthenticatedPrincipal,
  type OffsetPaginated,
  type SchemeSummary,
} from '@medichain/shared-types';
import {
  CurrentTenant,
  CurrentUser,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { SchemeManagementService } from '../application/scheme-management.service';
import {
  CreateSchemeDto,
  ListSchemesQueryDto,
  UpdateSchemeDto,
} from './dto/scheme.dto';

@ApiTags('schemes')
@ApiBearerAuth()
@Controller('schemes')
export class SchemeController {
  constructor(private readonly schemes: SchemeManagementService) {}

  @Get()
  @RequireCapability(Capability.SCHEME_WRITE)
  @ApiOperation({ summary: 'List schemes' })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListSchemesQueryDto,
  ): Promise<OffsetPaginated<SchemeSummary>> {
    return this.schemes.list(tenantId, query);
  }

  @Get(':id')
  @RequireCapability(Capability.SCHEME_WRITE)
  @ApiOperation({ summary: 'Get a scheme by id' })
  async getById(
    @CurrentTenant() tenantId: string,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<{ data: SchemeSummary }> {
    const row = await this.schemes.getById(tenantId, id);
    return { data: row };
  }

  @Post()
  @RequireCapability(Capability.SCHEME_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a scheme' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateSchemeDto,
  ): Promise<{ data: { id: string } }> {
    const result = await this.schemes.create(tenantId, principal.userId, dto);
    return { data: result };
  }

  @Patch(':id')
  @RequireCapability(Capability.SCHEME_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update a scheme' })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: UpdateSchemeDto,
  ): Promise<void> {
    await this.schemes.update(tenantId, id, principal.userId, dto);
  }

  @Delete(':id')
  @RequireCapability(Capability.SCHEME_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive (deactivate) a scheme' })
  async archive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<void> {
    await this.schemes.archive(tenantId, id, principal.userId);
  }
}
