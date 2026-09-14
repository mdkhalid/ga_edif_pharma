import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../domain/value-objects/password.vo';

/**
 * Request DTOs.
 *
 * Classes, not interfaces. An interface is erased at compile time, so
 * `ValidationPipe` has no metadata to validate against and silently becomes a
 * no-op — every request would be accepted with whatever shape the client sent.
 * The eslint config in this project rejects an interface used as a DTO for
 * exactly that reason.
 *
 * The decorators here are the *boundary* checks: types, formats, lengths. They
 * are deliberately not the whole rule — `Password.create` re-checks the policy
 * in the domain, because a boundary check can be bypassed by any caller that is
 * not an HTTP request (a seed, a queue consumer, another service). Validating
 * only at the edge means the invariant is a property of the transport rather
 * than of the domain.
 */

export class RegisterDto {
  @ApiPropertyOptional({
    example: 'buyer@sunrisepharma.in',
    description: 'Email address. Either this or `phone` is required.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'E.164 phone number. Either this or `email` is required.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'Enter a valid phone number, including the country code.',
  })
  phone?: string;

  @ApiProperty({ example: 'Priya Sharma', minLength: 2, maxLength: 200 })
  @IsString()
  @Length(2, 200)
  fullName!: string;

  @ApiProperty({
    example: 'a-long-and-memorable-passphrase',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description:
      `At least ${PASSWORD_MIN_LENGTH} characters. A phrase of a few words is stronger and ` +
      'easier to remember than a short jumble of symbols.',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({
    example: 'SUNRISE',
    description:
      'Code of the pharma company you are registering with. Required when the platform ' +
      'hosts more than one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  tenantCode?: string;
}

export class LoginDto {
  @ApiProperty({
    example: 'buyer@sunrisepharma.in',
    description: 'Email address or phone number.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  identifier!: string;

  @ApiProperty({ example: 'a-long-and-memorable-passphrase' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-...',
    description: 'Stable per-installation identifier, shown on the "your devices" screen.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @ApiPropertyOptional({ example: 'Chrome on Windows', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceLabel?: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'The refresh token issued by the previous sign-in or refresh. Rotated on every use — ' +
      'store the new value returned by this call and discard the old one.',
  })
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  refreshToken!: string;
}

export class RevokeSessionDto {
  @ApiProperty({ description: 'Session id to revoke, from the sessions list.' })
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  sessionId!: string;
}

/**
 * The six-digit code the user received, as a string.
 *
 * A string rather than a number on purpose: `048392` is a valid code, and typing
 * it into a JSON number field loses the leading zero. `@Length(6, 6)` also rejects
 * a padded or truncated value before it reaches the digest comparison.
 */
const OTP_CODE_VALIDATORS = {
  message: 'Enter the six-digit code from the email or SMS.',
} as const;

export class VerifyContactRequestDto {
  @ApiProperty({
    example: 'buyer@sunrisepharma.in',
    description: 'The email address or phone number to verify.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  identifier!: string;
}

export class VerifyContactDto {
  @ApiProperty({
    example: 'buyer@sunrisepharma.in',
    description: 'The email address or phone number that was registered.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  identifier!: string;

  @ApiProperty({
    example: '048392',
    minLength: 6,
    maxLength: 6,
    description:
      'The six-digit code sent to the email address or phone number. Single-use, ' +
      'expires shortly, and capped after a few wrong attempts.',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, OTP_CODE_VALIDATORS)
  code!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'buyer@sunrisepharma.in',
    description:
      'The email address or phone number on the account. The response is the same ' +
      'whether or not an account exists.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    example: 'buyer@sunrisepharma.in',
    description: 'The email address or phone number on the account.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  identifier!: string;

  @ApiProperty({
    example: '048392',
    minLength: 6,
    maxLength: 6,
    description: 'The six-digit reset code.',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, OTP_CODE_VALIDATORS)
  code!: string;

  @ApiProperty({
    example: 'a-new-long-and-memorable-passphrase',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description:
      `The new password, at least ${PASSWORD_MIN_LENGTH} characters. The same policy as ` +
      'registration applies, and every existing session is signed out.',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
