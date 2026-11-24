import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Capability, type PriceListDetail, type PriceListPage } from '@medichain/shared-types';

import { CurrentTenant, RequireCapability } from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { PriceListManagementService } from '../application/price-list-management.service';
import { ListPriceListsQuery } from './dto/price-list.dto';

@ApiTags('price-lists')
@ApiBearerAuth()
@Controller('price-lists')
export class PriceListController {
  constructor(private readonly priceLists: PriceListManagementService) {}

  @Get()
  @RequireCapability(Capability.PRICING_READ)
  @ApiOperation({ summary: 'List price lists with line and customer counts' })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPriceListsQuery,
  ): Promise<PriceListPage> {
    return this.priceLists.list(tenantId, query);
  }

  @Get(':id')
  @RequireCapability(Capability.PRICING_READ)
  @ApiOperation({ summary: 'Get a price list with its tiered lines and assignments' })
  async getById(
    @CurrentTenant() tenantId: string,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<{ data: PriceListDetail }> {
    return { data: await this.priceLists.getById(tenantId, id) };
  }
}
