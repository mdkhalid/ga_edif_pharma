import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Capability, OrderStatus, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  Idempotent,
  RequireAnyCapability,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { ForbiddenError, NotFoundError } from '../../../common/exceptions/domain.exception';
import { OrderService } from '../application/order.service';
import { ListOrdersQuery, PlaceOrderDto, TransitionDto } from './dto/order.dto';

/**
 * Order endpoints.
 *
 * Placement is always from the caller's ACTIVE cart and is idempotent: a
 * retry with the same `Idempotency-Key` replays the first response instead
 * of creating a second order. Fulfilment transitions are staff-only and
 * follow the canonical `ORDER_TRANSITIONS` machine.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @RequireCapability(Capability.ORDER_CREATE)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place an order from the active cart' })
  @ApiResponse({ status: 201, description: 'Order placed; stock reserved.' })
  async place(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: PlaceOrderDto,
  ): Promise<{ data: { id: string; total: string } }> {
    const organisationId = this.requireBuyerOrg(principal);
    const result = await this.orders.place(tenantId, organisationId, principal.userId, dto);
    return { data: result };
  }

  @Get()
  @RequireCapability(Capability.ORDER_READ)
  @ApiOperation({ summary: 'List orders (own organisation, or all for staff)' })
  @ApiResponse({ status: 200, description: 'Paginated order list.' })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListOrdersQuery,
  ): Promise<{
    data: Array<{ id: string; status: string; total: string; createdAt: Date }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    return this.orders.list(tenantId, principal.organisationId, this.isStaff(principal), query);
  }

  @Get(':id')
  @RequireCapability(Capability.ORDER_READ)
  @ApiOperation({ summary: 'Get an order with its lines' })
  @ApiResponse({ status: 200, description: 'The order.' })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<{
    data: {
      id: string;
      status: string;
      paymentStatus: string;
      total: string;
      items: Array<{ productId: string; productName: string; quantity: string; price: string }>;
    };
  }> {
    const row = await this.orders.getById(
      tenantId,
      id,
      principal.organisationId,
      this.isStaff(principal),
    );
    if (!row) throw new NotFoundError('Order not found.');
    return { data: row };
  }

  @Post(':id/confirm')
  @RequireCapability(Capability.ORDER_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a placed order' })
  async confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: TransitionDto,
  ): Promise<{ data: { id: string; status: OrderStatus } }> {
    await this.orders.transition(tenantId, id, OrderStatus.CONFIRMED, principal.userId, dto.reason);
    return { data: { id, status: OrderStatus.CONFIRMED } };
  }

  @Post(':id/process')
  @RequireCapability(Capability.ORDER_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start processing a confirmed order' })
  async process(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: TransitionDto,
  ): Promise<{ data: { id: string; status: OrderStatus } }> {
    await this.orders.transition(tenantId, id, OrderStatus.PROCESSING, principal.userId, dto.reason);
    return { data: { id, status: OrderStatus.PROCESSING } };
  }

  @Post(':id/dispatch')
  @RequireCapability(Capability.ORDER_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatch a processing order' })
  async dispatch(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: TransitionDto,
  ): Promise<{ data: { id: string; status: OrderStatus } }> {
    await this.orders.transition(tenantId, id, OrderStatus.DISPATCHED, principal.userId, dto.reason);
    return { data: { id, status: OrderStatus.DISPATCHED } };
  }

  @Post(':id/deliver')
  @RequireCapability(Capability.ORDER_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a dispatched order delivered' })
  async deliver(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: TransitionDto,
  ): Promise<{ data: { id: string; status: OrderStatus } }> {
    await this.orders.transition(tenantId, id, OrderStatus.DELIVERED, principal.userId, dto.reason);
    return { data: { id, status: OrderStatus.DELIVERED } };
  }

  @Post(':id/cancel')
  @RequireAnyCapability(Capability.ORDER_CANCEL, Capability.ORDER_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an order and release its reservations' })
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: TransitionDto,
  ): Promise<{ data: { id: string; status: OrderStatus } }> {
    await this.orders.transition(tenantId, id, OrderStatus.CANCELLED, principal.userId, dto.reason);
    return { data: { id, status: OrderStatus.CANCELLED } };
  }

  private requireBuyerOrg(principal: AuthenticatedPrincipal): string {
    if (!principal.organisationId) {
      throw new ForbiddenError('Orders are placed by a buying organisation.');
    }
    return principal.organisationId;
  }

  private isStaff(principal: AuthenticatedPrincipal): boolean {
    return principal.capabilities.includes(Capability.ORDER_APPROVE);
  }
}
