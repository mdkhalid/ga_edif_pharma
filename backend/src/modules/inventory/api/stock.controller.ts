import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Capability, type StockPage, type StockSummary } from '@medichain/shared-types';

import { CurrentTenant, RequireCapability } from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { StockQueryService } from '../application/stock-query.service';
import { ListStockQuery } from './dto/stock.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/stock')
export class StockController {
  constructor(private readonly stock: StockQueryService) {}

  @Get()
  @RequireCapability(Capability.INVENTORY_READ)
  @ApiOperation({ summary: 'List warehouse stock levels with available quantities' })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListStockQuery,
  ): Promise<StockPage> {
    return this.stock.list(tenantId, query);
  }

  @Get(':id')
  @RequireCapability(Capability.INVENTORY_READ)
  @ApiOperation({ summary: 'Get one warehouse stock record' })
  async getById(
    @CurrentTenant() tenantId: string,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<{ data: StockSummary }> {
    return { data: await this.stock.getById(tenantId, id) };
  }
}
