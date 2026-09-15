import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Order DTOs. Placement takes no line items — the order is always placed
 * from the caller's ACTIVE cart, so the cart's availability checks are the
 * order's availability checks.
 */
export class PlaceOrderDto {
  @ApiPropertyOptional({ example: '14, Residency Road, Bengaluru 560025' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 'Call before delivery', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class TransitionDto {
  @ApiPropertyOptional({ example: 'Verified over phone.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListOrdersQuery {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ example: 'PLACED' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;
}
