import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Capability, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  Idempotent,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { CartService } from '../application/cart.service';
import { AddItemDto, UpdateItemDto } from './dto/cart.dto';

/**
 * Buyer cart endpoints. The cart always belongs to the caller's
 * organisation; there is no cart id in the path to guess.
 */
@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @RequireCapability(Capability.CART_READ)
  @ApiOperation({ summary: 'Read the caller organisation’s active cart' })
  @ApiResponse({ status: 200, description: 'Cart with live prices and availability.' })
  async get(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<{ data: Awaited<ReturnType<CartService['get']>> }> {
    const organisationId = this.cart.requireOrganisationId(principal.organisationId);
    return { data: await this.cart.get(tenantId, organisationId) };
  }

  @Post('items')
  @RequireCapability(Capability.CART_WRITE)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an item to the cart at the live price' })
  @ApiResponse({ status: 201, description: 'Item added.' })
  async add(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: AddItemDto,
  ): Promise<{ data: { cartId: string } }> {
    const organisationId = this.cart.requireOrganisationId(principal.organisationId);
    const result = await this.cart.add(
      tenantId,
      organisationId,
      dto.productId,
      dto.quantity,
      principal.userId,
    );
    return { data: result };
  }

  @Patch('items/:productId')
  @RequireCapability(Capability.CART_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change an item quantity (zero removes it)' })
  @ApiResponse({ status: 200, description: 'Item updated.' })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('productId', uuidParam('productId')) productId: string,
    @Body() dto: UpdateItemDto,
  ): Promise<{ data: { productId: string } }> {
    const organisationId = this.cart.requireOrganisationId(principal.organisationId);
    await this.cart.updateQty(tenantId, organisationId, productId, dto.quantity, principal.userId);
    return { data: { productId } };
  }

  @Delete('items/:productId')
  @RequireCapability(Capability.CART_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an item from the cart' })
  @ApiResponse({ status: 204, description: 'Item removed.' })
  async remove(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('productId', uuidParam('productId')) productId: string,
  ): Promise<void> {
    const organisationId = this.cart.requireOrganisationId(principal.organisationId);
    await this.cart.remove(tenantId, organisationId, productId, principal.userId);
  }
}
