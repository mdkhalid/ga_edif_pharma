import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

import type { VerificationDecision } from '../../domain/prescription.types';

export class CreatePrescriptionDto {
  @ApiProperty({ example: 'org-uuid' })
  @IsUUID()
  organisationId!: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  patientRef?: string | null;

  @ApiPropertyOptional({ example: 'Dr. Smith' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  doctorName?: string | null;

  @ApiPropertyOptional({ example: 'RX-12345' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string | null;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00Z' })
  @IsOptional()
  @IsString()
  validFrom?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsString()
  validTo?: string | null;

  @ApiPropertyOptional({ example: 's3://bucket/key' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentKey?: string | null;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  attachmentMimeType?: string | null;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxDispensings?: number;
}

export class VerifyPrescriptionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsEnum(['APPROVE', 'REJECT'])
  decision!: VerificationDecision;

  @ApiPropertyOptional({ example: 'Illegible handwriting' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class ListPrescriptionsQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

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
}
