import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SessionRevokedReason } from '@medichain/shared-types';

import {
  CurrentUser,
  Idempotent,
  Public,
  RateLimit,
  SkipTenantScope,
} from '../../../common/decorators';
import { HEADERS, RATE_LIMIT_BUCKET } from '../../../common/constants/metadata';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { AuthService } from '../application/services/auth.service';
import { ContactVerificationService } from '../application/services/contact-verification.service';
import { PasswordResetService } from '../application/services/password-reset.service';
import { SessionService } from '../application/services/session.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyContactDto,
  VerifyContactRequestDto,
} from './dto/auth.dto';

/**
 * Authentication endpoints.
 *
 * ## Why every route here is `@SkipTenantScope()`
 *
 * A tenant is derived *from* authentication, so it cannot be required *by* it.
 * At the moment `/auth/login` runs there is no principal and therefore no tenant
 * on the request context. Declaring the skip explicitly — rather than leaving it
 * to be inferred — makes the exception visible in the controller, which is where
 * a reviewer will look for it.
 *
 * `/auth/me` is the exception within the exception: it is authenticated, so it
 * has a tenant, and it deliberately does not skip the scope.
 *
 * ## Rate limits
 *
 * Sign-in, registration and refresh all share the `AUTH` bucket, keyed by
 * `ip+identifier`. Keying on the identifier is what stops an attacker from
 * hammering one account while staying under a per-IP limit, without penalising
 * everyone behind the same carrier NAT — which, for a distributor's delivery
 * staff on one mobile network, is the common case.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly verification: ContactVerificationService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('register')
  @Public()
  @SkipTenantScope()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ bucket: RATE_LIMIT_BUCKET.AUTH, keyBy: 'ip', max: 5, windowSeconds: 300 })
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates an account in PENDING_VERIFICATION. The account cannot sign in until the ' +
      'email or phone number is verified — that address is where order confirmations and ' +
      'prescription decisions are sent, so it must be real before it can be used.',
  })
  @ApiResponse({ status: 201, description: 'Account created; verification required.' })
  @ApiResponse({ status: 409, description: 'An account with these details already exists.' })
  @ApiResponse({ status: 429, description: 'Too many registration attempts.' })
  async register(@Body() dto: RegisterDto): Promise<{ data: { userId: string; tenantId: string } }> {
    const result = await this.auth.register({
      email: dto.email,
      phone: dto.phone,
      fullName: dto.fullName,
      password: dto.password,
      tenantCode: dto.tenantCode,
    });

    return {
      data: result,
    };
  }

  @Post('verify/request')
  @Public()
  @SkipTenantScope()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: RATE_LIMIT_BUCKET.OTP, keyBy: 'ip+identifier', max: 5, windowSeconds: 300 })
  @ApiOperation({
    summary: 'Request a contact-verification code',
    description:
      'Sends a one-time code to the email address or phone number an account was registered with. ' +
      'The response is the same whether or not the account exists, and whether or not it still ' +
      'needs verifying — so this cannot be used to discover which addresses are registered.',
  })
  @ApiResponse({
    status: 202,
    description: 'If the account is pending verification, a code has been sent.',
  })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  async requestContactVerification(
    @Body() dto: VerifyContactRequestDto,
  ): Promise<{ data: Awaited<ReturnType<ContactVerificationService['request']>> }> {
    const result = await this.verification.request(dto.identifier);
    return { data: result };
  }

  @Post('verify')
  @Public()
  @SkipTenantScope()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: RATE_LIMIT_BUCKET.OTP, keyBy: 'ip+identifier', max: 10, windowSeconds: 300 })
  @ApiOperation({
    summary: 'Verify an email address or phone number',
    description:
      'Consumes a verification code and activates the account. The code is single-use, expires, ' +
      'and is rejected after a small number of wrong attempts.',
  })
  @ApiResponse({ status: 200, description: 'Contact verified; the account is now active.' })
  @ApiResponse({ status: 400, description: 'The code is invalid or has expired.' })
  @ApiResponse({ status: 429, description: 'Too many wrong attempts for this code.' })
  async verifyContact(
    @Body() dto: VerifyContactDto,
  ): Promise<{ data: Awaited<ReturnType<ContactVerificationService['verify']>> }> {
    const result = await this.verification.verify(dto.identifier, dto.code);
    return { data: result };
  }

  @Post('login')
  @Public()
  @SkipTenantScope()
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    bucket: RATE_LIMIT_BUCKET.AUTH,
    keyBy: 'ip+identifier',
    max: 10,
    windowSeconds: 60,
  })
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Exchanges credentials for an access token (15 minutes) and a refresh token (30 days). ' +
      'The refresh token is rotated on every use; reuse of a rotated token revokes the entire ' +
      'token family.',
  })
  @ApiResponse({ status: 200, description: 'Signed in.' })
  @ApiResponse({ status: 401, description: 'Credentials are incorrect.' })
  @ApiResponse({ status: 423, description: 'Account temporarily locked.' })
  @ApiResponse({ status: 429, description: 'Too many attempts.' })
  async login(@Body() dto: LoginDto): Promise<{ data: Awaited<ReturnType<AuthService['login']>> }> {
    const result = await this.auth.login({
      identifier: dto.identifier,
      password: dto.password,
      deviceId: dto.deviceId,
      deviceLabel: dto.deviceLabel,
    });

    return { data: result };
  }

  @Post('refresh')
  @Public()
  @SkipTenantScope()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: RATE_LIMIT_BUCKET.AUTH, keyBy: 'ip', max: 60, windowSeconds: 60 })
  @ApiOperation({
    summary: 'Rotate tokens',
    description:
      'Exchanges a refresh token for a new access/refresh pair. The presented token is ' +
      'invalidated. Presenting an already-used token revokes every session in its family — ' +
      'that is the replay-detection behaviour, and it is intentional.',
  })
  @ApiResponse({ status: 200, description: 'Tokens rotated.' })
  @ApiResponse({ status: 401, description: 'The refresh token is invalid, expired or replayed.' })
  async refresh(
    @Body() dto: RefreshTokenDto,
  ): Promise<{ data: Awaited<ReturnType<AuthService['refresh']>> }> {
    const result = await this.auth.refresh(dto.refreshToken);
    return { data: result };
  }

  @Post('password/forgot')
  @Public()
  @SkipTenantScope()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: RATE_LIMIT_BUCKET.OTP, keyBy: 'ip+identifier', max: 5, windowSeconds: 300 })
  @ApiOperation({
    summary: 'Request a password-reset code',
    description:
      'Sends a one-time code to the email address or phone number on the account. The response is ' +
      'identical whether or not an account exists, so it cannot be used to enumerate users.',
  })
  @ApiResponse({ status: 202, description: 'If an account exists, a reset code has been sent.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ data: Awaited<ReturnType<PasswordResetService['forgot']>> }> {
    const result = await this.passwordReset.forgot(dto.identifier);
    return { data: result };
  }

  @Post('password/reset')
  @Public()
  @SkipTenantScope()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: RATE_LIMIT_BUCKET.OTP, keyBy: 'ip+identifier', max: 10, windowSeconds: 300 })
  @ApiOperation({
    summary: 'Reset a password with a one-time code',
    description:
      'Consumes a reset code and sets a new password. Every existing session is revoked, so a ' +
      'stolen session does not outlive the reset.',
  })
  @ApiResponse({ status: 200, description: 'Password reset; all sessions revoked.' })
  @ApiResponse({ status: 400, description: 'The code is invalid or has expired.' })
  @ApiResponse({ status: 429, description: 'Too many wrong attempts for this code.' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ data: Awaited<ReturnType<PasswordResetService['reset']>> }> {
    const result = await this.passwordReset.reset({
      identifier: dto.identifier,
      code: dto.code,
      newPassword: dto.newPassword,
    });
    return { data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sign out of this device',
    description:
      'Revokes only the session that made the request. Other devices stay signed in — use ' +
      '"sign out everywhere" for that.',
  })
  @ApiResponse({ status: 204, description: 'Signed out.' })
  async logout(@CurrentUser() principal: { userId: string; sessionId: string }): Promise<void> {
    await this.auth.logout(principal.sessionId, principal.userId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sign out of every device',
    description: 'Revokes every active session for the account, including this one.',
  })
  @ApiResponse({ status: 200, description: 'All sessions revoked.' })
  async logoutAll(
    @CurrentUser() principal: { userId: string },
  ): Promise<{ data: { revokedSessions: number } }> {
    const count = await this.sessions.revokeAllForUser(
      principal.userId,
      SessionRevokedReason.ADMIN_FORCED,
    );
    return { data: { revokedSessions: count } };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Current profile',
    description:
      'Returns the authenticated account with its roles and the capabilities it currently ' +
      'holds. Capabilities are resolved live, so a permission change is reflected on the ' +
      'next request rather than when the access token expires.',
  })
  @ApiResponse({ status: 200, description: 'The authenticated profile.' })
  async me(
    @CurrentUser() principal: { userId: string },
  ): Promise<{ data: Awaited<ReturnType<AuthService['me']>> }> {
    const profile = await this.auth.me(principal.userId);
    return { data: profile };
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Active sessions',
    description: 'Lists the devices currently signed in, for the "your devices" screen.',
  })
  @ApiResponse({ status: 200, description: 'Active sessions.' })
  async listSessions(
    @CurrentUser() principal: { userId: string; sessionId: string },
  ): Promise<{
    data: Array<{
      id: string;
      deviceId: string | null;
      deviceLabel: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: string;
      expiresAt: string;
      current: boolean;
    }>;
  }> {
    const rows = await this.sessions.listActiveSessions(principal.userId);

    return {
      data: rows.map((row) => ({
        id: row.id,
        deviceId: row.deviceId,
        deviceLabel: row.deviceLabel,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        current: row.id === principal.sessionId,
      })),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke a specific session',
    description: 'Signs out one device. The caller must own the session.',
  })
  @ApiResponse({ status: 204, description: 'Session revoked.' })
  @ApiResponse({ status: 401, description: 'The session does not belong to this account.' })
  async revokeSession(
    @Param('sessionId', uuidParam('sessionId')) sessionId: string,
    @CurrentUser() principal: { userId: string },
  ): Promise<void> {
    await this.sessions.assertSessionOwnership(sessionId, principal.userId);
    await this.sessions.revokeSession(sessionId, SessionRevokedReason.LOGOUT);
  }
}

/** Re-exported so the OpenAPI document advertises the header clients must send. */
export const AUTH_HEADERS = [HEADERS.IDEMPOTENCY_KEY] as const;
