import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Every optional field states its Swagger `type` explicitly. A union typed
 * `string | null` reflects as `Object` and would otherwise generate
 * `Record<string, never>` in the typed client — see A12.
 */
const PROVIDERS = ['mock', 'razorpay', 'stripe', 'payu'] as const;
const WEBHOOK_EVENTS = ['AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'] as const;

export class CreatePaymentIntentDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({
    type: String,
    enum: PROVIDERS,
    description: 'Defaults to the provider configured for this deployment.',
  })
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Required for staff callers; buyers are scoped to their own organisation.',
  })
  @IsOptional()
  @IsUUID()
  organisationId?: string;
}

export class ListPaymentsQuery {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ type: Number, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class RefundPaymentDto {
  @ApiPropertyOptional({ type: String, example: 'Buyer cancelled the order.', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason?: string;
}

/** Normalised callback body. The raw bytes are signed; this is the parsed view. */
export class PaymentWebhookDto {
  @ApiProperty({ type: String, example: 'evt_12345' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  eventId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  paymentId!: string;

  @ApiProperty({ type: String, enum: WEBHOOK_EVENTS })
  @IsIn(WEBHOOK_EVENTS)
  type!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gatewayReference?: string;

  @ApiPropertyOptional({ type: String, example: '236.00' })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({ type: String, example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}
