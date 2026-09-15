import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

import { OrgType } from '@medichain/shared-types';

/**
 * Phase 1 onboarding DTOs.
 *
 * Classes, not interfaces, so ValidationPipe has metadata to enforce.
 * Boundary checks only; domain rules (e.g. licence required for activation)
 * live in the service.
 */
export class SubmitApplicationDto {
  @ApiProperty({ enum: OrgType, example: OrgType.DISTRIBUTOR })
  @IsEnum(OrgType)
  type!: string;

  @ApiProperty({ example: 'Sunrise Pharma Distributors Pvt Ltd' })
  @IsString()
  @Length(2, 300)
  legalName!: string;

  @ApiPropertyOptional({ example: 'Sunrise Pharma' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  tradeName?: string;

  @ApiPropertyOptional({ example: 'DL-KA-2026-01234' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  drugLicenceNo?: string;

  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, {
    message: 'Enter a valid 15-character GSTIN.',
  })
  gstin?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  pan?: string;

  @ApiPropertyOptional({ example: '29' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  stateCode?: string;

  @ApiPropertyOptional({ example: 'buyer@sunrisepharma.in' })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class ReviewApplicationDto {
  @ApiPropertyOptional({ example: 'Licence verified against portal.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
