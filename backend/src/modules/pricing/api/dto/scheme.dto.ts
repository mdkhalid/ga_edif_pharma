import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSchemeDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: ['PERCENTAGE', 'FLAT', 'FREE_GOODS', 'COMBO'] })
  @IsIn(['PERCENTAGE', 'FLAT', 'FREE_GOODS', 'COMBO'])
  kind!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID() productId?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @IsUUID() categoryId?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsNumber() percentOff?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsNumber() flatOff?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(0) minQty?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(0) buyQty?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(0) freeQty?: number | null;

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) comboProductIds?: string[];

  @ApiProperty() @IsString() validFrom!: string;
  @ApiProperty() @IsString() validTo!: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() stackable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
}

export class UpdateSchemeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsNumber() percentOff?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsNumber() flatOff?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(0) minQty?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(0) buyQty?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(0) freeQty?: number | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) comboProductIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() stackable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
}

export class ListSchemesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() kind?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
