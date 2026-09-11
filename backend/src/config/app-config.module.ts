import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { AppConfigService, ENV } from './app-config.service';
import { validateEnv, type Env } from './env.schema';

/**
 * Global configuration module.
 *
 * Two responsibilities, deliberately separated:
 *   1. `NestConfigModule.forRoot` loads `.env` files into `process.env`.
 *   2. The `ENV` provider validates `process.env` once and fails the boot if
 *      anything is wrong.
 *
 * Validation is not delegated to `forRoot({ validate })` because we want a
 * single, typed, injectable object that tests can replace wholesale.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      // Tests supply their own environment; a stray .env file would make the
      // suite depend on a developer's local machine.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
  ],
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => validateEnv(process.env as Record<string, unknown>),
    },
    AppConfigService,
  ],
  exports: [ENV, AppConfigService],
})
export class AppConfigModule {}
