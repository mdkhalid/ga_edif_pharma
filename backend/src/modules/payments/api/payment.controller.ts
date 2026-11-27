import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Capability, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  Idempotent,
  Public,
  RawResponse,
  RequireCapability,
  SkipTenantScope,
} from '../../../common/decorators';
import { ValidationFailedError } from '../../../common/exceptions/domain.exception';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { PaymentService } from '../application/payment.service';
import type { PaymentProvider, PaymentWebhookEvent } from '../domain/payment.types';
import {
  CreatePaymentIntentDto,
  ListPaymentsQuery,
  PaymentWebhookDto,
  RefundPaymentDto,
} from './dto/payment.dto';

const PROVIDERS: readonly string[] = ['mock', 'razorpay', 'stripe', 'payu'];

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('intents')
  @Idempotent()
  @RequireCapability(Capability.PAYMENT_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payment intent for an order' })
  async createIntent(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: CreatePaymentIntentDto,
  ): Promise<{ data: unknown }> {
    const staff = principal.capabilities.includes(Capability.PAYMENT_REFUND);
    const payment = await this.payments.createIntent(
      tenantId,
      principal.userId,
      staff ? (dto.organisationId ?? null) : principal.organisationId,
      idempotencyKey,
      dto,
    );
    return { data: payment };
  }

  @Get()
  @RequireCapability(Capability.PAYMENT_READ)
  @ApiOperation({ summary: 'List payments (own organisation, or all for staff)' })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListPaymentsQuery,
  ): Promise<unknown> {
    return this.payments.list(
      tenantId,
      principal.organisationId,
      principal.capabilities.includes(Capability.PAYMENT_REFUND),
      query,
    );
  }

  @Get(':id')
  @RequireCapability(Capability.PAYMENT_READ)
  @ApiOperation({ summary: 'Get a payment by id' })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<{ data: unknown }> {
    const payment = await this.payments.getById(
      tenantId,
      id,
      principal.organisationId,
      principal.capabilities.includes(Capability.PAYMENT_REFUND),
    );
    return { data: payment };
  }

  @Post(':id/refund')
  @RequireCapability(Capability.PAYMENT_REFUND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate a refund for a captured payment' })
  async refund(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<{ data: { id: string } }> {
    await this.payments.refund(tenantId, principal.userId, id, dto.reason ?? 'Refund requested.');
    return { data: { id } };
  }

  /**
   * Gateway callback. Anonymous by necessity; the HMAC over the exact bytes
   * received is the authentication. No tenant is known until the signature has
   * been checked and the payment row has supplied one.
   */
  @Post('webhooks')
  @Public()
  @SkipTenantScope()
  @RawResponse()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'x-payment-provider',
    required: false,
    description: 'Gateway sending the callback. Defaults to the configured provider.',
  })
  @ApiHeader({
    name: 'x-payment-signature',
    required: true,
    description: 'HMAC-SHA256, hex encoded, of the exact request body bytes.',
  })
  @ApiOperation({ summary: 'Signed payment webhook from a configured gateway' })
  async webhook(
    @Req() request: ExpressRequest & { rawBody?: Buffer },
    @Headers('x-payment-provider') providerHeader: string | undefined,
    @Headers('x-payment-signature') signature: string | undefined,
    @Body() dto: PaymentWebhookDto,
  ): Promise<{ received: true; duplicate: boolean }> {
    const provider = providerHeader ?? 'mock';
    if (!PROVIDERS.includes(provider)) {
      throw new ValidationFailedError(`Unknown payment provider: ${provider}`);
    }
    if (!signature) {
      throw new ValidationFailedError('Missing X-Payment-Signature header.');
    }

    const event: PaymentWebhookEvent = {
      eventId: dto.eventId,
      paymentId: dto.paymentId,
      type: dto.type as PaymentWebhookEvent['type'],
      ...(dto.gatewayReference !== undefined ? { gatewayReference: dto.gatewayReference } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
    };

    return this.payments.handleWebhook(
      provider as PaymentProvider,
      event,
      (request.rawBody ?? Buffer.from(JSON.stringify(dto))).toString('utf8'),
      signature,
    );
  }
}
