import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Capability } from '@medichain/shared-types';

import { RequireAnyCapability } from '../../../common/decorators';
import { SaltEngineService } from '../../salt-engine';
import { SearchProductsQuery } from './dto/search.dto';

/**
 * Search endpoints. Thin HTTP over the salt engine: parsing, matching and
 * paging semantics belong to the engine, not the transport.
 */
@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly salts: SaltEngineService) {}

  @Get('products')
  @RequireAnyCapability(Capability.SALT_READ, Capability.CATALOG_READ)
  @ApiOperation({ summary: 'Search products by salt combination' })
  @ApiResponse({ status: 200, description: 'Matching products; `exact` marks canonical-key hits.' })
  async searchProducts(@Query() query: SearchProductsQuery): Promise<{
    data: Array<{ id: string; name: string; schedule: string; price: string; exact: boolean }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    return this.salts.search(query.q, {
      schedule: query.schedule,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
