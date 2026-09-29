import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Invoice DTOs. An invoice is always issued against an order — the lines,
 * prices and discounts come from the order, never from the request — so the
 * issue DTO carries only the order and the rounding policy.
 */
export class IssueInvoiceDto {
  @ApiProperty({ example: '3f3c8c4e-9f2a-4b6d-8e1f-2a3b4c5d6e7f' })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  roundToWholeRupee?: boolean;
}

export class CancelInvoiceDto {
  @ApiPropertyOptional({ example: 'Billed to the wrong GSTIN; re-issuing.', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ListInvoicesQuery {
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

  @ApiPropertyOptional({ example: 'ISSUED' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ example: '3f3c8c4e-9f2a-4b6d-8e1f-2a3b4c5d6e7f' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}
