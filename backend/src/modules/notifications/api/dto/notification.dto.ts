import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;

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

export class UnregisterPushTokenDto {
  @ApiProperty({ description: 'Provider-issued device token', maxLength: 512 })
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  token!: string;
}

export class SetChannelPreferenceDto {
  @ApiProperty({ description: 'Whether the channel should deliver to this user' })
  @IsBoolean()
  enabled!: boolean;
}

export class UpsertNotificationTemplateDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ['IN_APP', 'EMAIL', 'SMS', 'PUSH'] })
  @IsIn(['IN_APP', 'EMAIL', 'SMS', 'PUSH'])
  channel!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  body!: string;
}

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'Provider-issued device token', maxLength: 512 })
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';

  @ApiPropertyOptional({
    description: 'Transport the token belongs to. Defaults to the configured provider.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  provider?: string;
}

