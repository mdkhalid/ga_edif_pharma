import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Max, Min } from 'class-validator';

/**
 * Cart DTOs. Quantities are in pack units and must be positive on add;
 * setting an item to zero via update removes it.
 */
export class AddItemDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 10, minimum: 1, maximum: 10000 })
  @IsNumber()
  @Min(1)
  @Max(10000)
  quantity!: number;
}

export class UpdateItemDto {
  @ApiProperty({ example: 5, minimum: 0, maximum: 10000 })
  @IsNumber()
  @Min(0)
  @Max(10000)
  quantity!: number;
}
