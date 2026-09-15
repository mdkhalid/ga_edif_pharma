import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Salt search query. `q` accepts `Paracetamol + Cetirizine` or
 * `paracetamol,cetirizine`; parsing lives in the salt engine.
 */
export class SearchProductsQuery {
  @ApiProperty({ example: 'Paracetamol + Cetirizine' })
  @IsString()
  @MaxLength(300)
  q!: string;

  @ApiPropertyOptional({ enum: ['OTC', 'H', 'H1', 'X', 'NARCOTIC'] })
  @IsOptional()
  @IsIn(['OTC', 'H', 'H1', 'X', 'NARCOTIC'])
  schedule?: string;

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
