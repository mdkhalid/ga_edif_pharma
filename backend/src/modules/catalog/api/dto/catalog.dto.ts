import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 1 catalogue DTOs. Boundary checks only; pricing and schedule rules
 * live in the service/domain.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'Paracetamol 650mg Strip of 15' })
  @IsString()
  @Length(2, 300)
  name!: string;

  @ApiPropertyOptional({ example: 'Fever and pain relief' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ example: 'OTC', enum: ['OTC', 'H', 'H1', 'X', 'NARCOTIC'] })
  @IsIn(['OTC', 'H', 'H1', 'X', 'NARCOTIC'])
  schedule!: string;

  @ApiPropertyOptional({ example: '30049099' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  hsnCode?: string;

  @ApiPropertyOptional({ example: '650mg' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  strength?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  packSize?: number;

  @ApiPropertyOptional({ example: 'strip' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  packUnit?: string;

  @ApiProperty({ example: 42.5 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: ['Paracetamol'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  saltAliases?: string[];

  @ApiPropertyOptional({ example: 'Paracetamol' })
  @IsOptional()
  @IsString()
  compositionKey?: string;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Paracetamol 650mg Strip of 15' })
  @IsOptional()
  @IsString()
  @Length(2, 300)
  name?: string;

  @ApiPropertyOptional({ example: 45.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: string;
}

export class ListProductsQuery {
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

  @ApiPropertyOptional({ example: 'para' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['OTC', 'H', 'H1', 'X', 'NARCOTIC'] })
  @IsOptional()
  @IsIn(['OTC', 'H', 'H1', 'X', 'NARCOTIC'])
  schedule?: string;

  @ApiPropertyOptional({ example: 'name' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort?: string;
}
