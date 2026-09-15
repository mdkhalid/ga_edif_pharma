import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Capability, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  Idempotent,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { CatalogService } from '../application/catalog.service';
import { CreateProductDto, ListProductsQuery, UpdateProductDto } from './dto/catalog.dto';

/**
 * Catalogue endpoints. All routes are authenticated; reads need
 * `catalog:read`, writes need `catalog:write`.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('products')
  @RequireCapability(Capability.CATALOG_WRITE)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a product' })
  @ApiResponse({ status: 201, description: 'Product created.' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateProductDto,
  ): Promise<{ data: { id: string } }> {
    const result = await this.catalog.create(tenantId, dto, principal.userId);
    return { data: result };
  }

  @Get('products')
  @RequireCapability(Capability.CATALOG_READ)
  @ApiOperation({ summary: 'Browse products' })
  @ApiResponse({ status: 200, description: 'Paginated product list.' })
  async list(@Query() query: ListProductsQuery): Promise<{
    data: Array<{ id: string; name: string; schedule: string; price: string; status: string }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    return this.catalog.list(query);
  }

  @Get('products/:id')
  @RequireCapability(Capability.CATALOG_READ)
  @ApiOperation({ summary: 'Get a product by id' })
  @ApiResponse({ status: 200, description: 'The product.' })
  async getById(@Param('id', uuidParam('id')) id: string): Promise<{
    data: { id: string; name: string; schedule: string; price: string; status: string; strength: string | null };
  }> {
    const row = await this.catalog.getById(id);
    if (!row) throw new NotFoundError('Product not found.');
    return { data: row };
  }

  @Patch('products/:id')
  @RequireCapability(Capability.CATALOG_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a product' })
  @ApiResponse({ status: 200, description: 'Product updated.' })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<{ data: { id: string } }> {
    await this.catalog.update(tenantId, id, dto, principal.userId);
    return { data: { id } };
  }
}
