import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AppConfigService } from '../../config/app-config.service';
import { SESSION_AUTHORITY, TOKEN_VERIFIER } from '../../common/ports/auth.port';
import { AuditModule } from '../audit';
import { NotificationsModule } from '../notifications';
import { AuthController } from './api/auth.controller';
import { AuthService } from './application/services/auth.service';
import { ContactVerificationService } from './application/services/contact-verification.service';
import { OtpService } from './application/services/otp.service';
import { PasswordResetService } from './application/services/password-reset.service';
import { PasswordService } from './application/services/password.service';
import { RoleResolver } from './application/services/role-resolver.service';
import { SessionService } from './application/services/session.service';
import { TokenService } from './application/services/token.service';

/**
 * Identity and access management.
 *
 * ## The port bindings are the important part of this file
 *
 * ```
 *   TOKEN_VERIFIER   → TokenService
 *   SESSION_AUTHORITY → SessionService
 * ```
 *
 * The guards in `common/` depend on those two interfaces, not on these classes.
 * Binding them here is what keeps the dependency direction correct: `common`
 * declares what it needs, `iam` supplies it. Without the indirection, the JWT
 * guard would import from `modules/iam` and the "common" layer would sit on top
 * of a feature module — the first step towards the cycle that makes a modular
 * monolith impossible to split later.
 *
 * It also means a future extracted auth service satisfies the same two
 * interfaces over HTTP, and only this file changes.
 *
 * ## Where the notification transport comes from
 *
 * `NotificationsModule` owns the `NOTIFICATION_PORT` binding (it used to live
 * here). Importing the module keeps the OTP flows working with no other
 * change, and the order flows consume the same transport.
 *
 * ## Why `JwtModule` is registered here and not globally
 *
 * Only this module signs and verifies tokens. Registering it globally would put
 * a signing capability in the injector of every module in the application, which
 * is a larger blast radius than the convenience is worth.
 */
@Module({
  imports: [
    AuditModule,
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwt.accessSecret,
        // Defaults only; each `sign`/`verify` call states them explicitly so the
        // algorithm can never be inferred from the token itself.
        signOptions: {
          algorithm: 'HS256',
          issuer: config.jwt.issuer,
          audience: config.jwt.audience,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: config.jwt.issuer,
          audience: config.jwt.audience,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    RoleResolver,
    SessionService,
    AuthService,
    OtpService,
    ContactVerificationService,
    PasswordResetService,
    { provide: TOKEN_VERIFIER, useExisting: TokenService },
    { provide: SESSION_AUTHORITY, useExisting: SessionService },
  ],
  exports: [
    AuthService,
    SessionService,
    PasswordService,
    RoleResolver,
    OtpService,
    ContactVerificationService,
    PasswordResetService,
    // Exported so the guards' dependencies resolve for any module that needs
    // them, and so an integration test can drive the token lifecycle directly.
    TOKEN_VERIFIER,
    SESSION_AUTHORITY,
  ],
})
export class IamModule {}
