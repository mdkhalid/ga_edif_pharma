import { Inject, Injectable } from '@nestjs/common';

import { parseDurationMs } from './duration';
import type { Env } from './env.schema';

/** DI token for the validated environment object. */
export const ENV = Symbol('ENV');

/**
 * Typed accessor over the validated environment.
 *
 * Components inject this rather than reading `process.env` directly, so that:
 *   - every read is type-checked,
 *   - derived values (TTLs in milliseconds, the database pool settings) are
 *     computed in exactly one place,
 *   - tests can construct a service from a literal object with no env plumbing.
 */
@Injectable()
export class AppConfigService {
  constructor(@Inject(ENV) private readonly raw: Env) {}

  /** Escape hatch for one-off reads. Prefer a named accessor. */
  get env(): Env {
    return this.raw;
  }

  // ------------------------------------------------------------------ app

  get nodeEnv(): Env['NODE_ENV'] {
    return this.raw.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.raw.NODE_ENV === 'production';
  }

  get isStaging(): boolean {
    return this.raw.NODE_ENV === 'staging';
  }

  get isDevelopment(): boolean {
    return this.raw.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.raw.NODE_ENV === 'test';
  }

  get port(): number {
    return this.raw.PORT;
  }

  get apiPrefix(): string {
    return this.raw.API_PREFIX;
  }

  get appName(): string {
    return this.raw.APP_NAME;
  }

  get publicBaseUrl(): string {
    return this.raw.PUBLIC_BASE_URL;
  }

  get corsOrigins(): readonly string[] {
    return this.raw.CORS_ORIGINS;
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.raw.LOG_LEVEL;
  }

  // ---------------------------------------------------------------- roles

  get appRole(): Env['APP_ROLE'] {
    return this.raw.APP_ROLE;
  }

  get isApiRole(): boolean {
    return this.raw.APP_ROLE === 'api';
  }

  get isWorkerRole(): boolean {
    return this.raw.APP_ROLE === 'worker';
  }

  get isSchedulerRole(): boolean {
    return this.raw.APP_ROLE === 'scheduler';
  }

  // ------------------------------------------------------------- database

  get database() {
    return {
      url: this.raw.DATABASE_URL,
      poolMin: this.raw.DATABASE_POOL_MIN,
      poolMax: this.raw.DATABASE_POOL_MAX,
      statementTimeoutMs: this.raw.DATABASE_STATEMENT_TIMEOUT_MS,
      idleInTransactionTimeoutMs: this.raw.DATABASE_IDLE_IN_TX_TIMEOUT_MS,
      synchronize: this.raw.DATABASE_SYNCHRONIZE,
    } as const;
  }

  get redis() {
    return {
      url: this.raw.REDIS_URL,
      keyPrefix: this.raw.REDIS_KEY_PREFIX,
    } as const;
  }

  get search() {
    return {
      useOpenSearch: this.raw.SEARCH_USE_OPENSEARCH,
      url: this.raw.OPENSEARCH_URL,
      username: this.raw.OPENSEARCH_USERNAME,
      password: this.raw.OPENSEARCH_PASSWORD,
    } as const;
  }

  // ----------------------------------------------------------------- auth

  get jwt() {
    return {
      accessSecret: this.raw.JWT_ACCESS_SECRET,
      refreshSecret: this.raw.JWT_REFRESH_SECRET,
      issuer: this.raw.JWT_ISSUER,
      audience: this.raw.JWT_AUDIENCE,
      /** Milliseconds. Parsed once, so no call site re-implements the parser. */
      accessTtlMs: parseDurationMs(this.raw.JWT_ACCESS_TTL),
      refreshTtlMs: parseDurationMs(this.raw.JWT_REFRESH_TTL),
    } as const;
  }

  get encryptionKey(): string {
    return this.raw.ENCRYPTION_KEY;
  }

  get argon2() {
    return {
      memoryCost: this.raw.ARGON2_MEMORY_COST,
      timeCost: this.raw.ARGON2_TIME_COST,
      parallelism: this.raw.ARGON2_PARALLELISM,
    } as const;
  }

  get loginSecurity() {
    return {
      maxAttempts: this.raw.MAX_LOGIN_ATTEMPTS,
      lockMinutes: this.raw.ACCOUNT_LOCK_MINUTES,
    } as const;
  }

  /** One-time-code policy for contact verification and password reset. */
  get authOtp(): {
    readonly ttlMinutes: number;
    readonly maxAttempts: number;
    readonly exposeInResponse: boolean;
  } {
    return {
      ttlMinutes: this.raw.AUTH_OTP_TTL_MINUTES,
      maxAttempts: this.raw.AUTH_OTP_MAX_ATTEMPTS,
      /**
       * True only when explicitly enabled AND not in production, so a
       * misconfiguration in a real environment cannot leak codes even if the
       * schema's production guard were somehow bypassed.
       */
      exposeInResponse:
        this.raw.AUTH_EXPOSE_OTP_IN_RESPONSE && this.raw.NODE_ENV !== 'production',
    };
  }

  // -------------------------------------------------------- rate limiting

  get rateLimit() {
    return {
      enabled: this.raw.RATE_LIMIT_ENABLED,
      windowSeconds: this.raw.RATE_LIMIT_TTL_SECONDS,
      defaultMax: this.raw.RATE_LIMIT_DEFAULT_MAX,
      authMax: this.raw.RATE_LIMIT_AUTH_MAX,
      searchMax: this.raw.RATE_LIMIT_SEARCH_MAX,
    } as const;
  }

  // ------------------------------------------------------ notifications

  /**
   * Outbound transport configuration.
   *
   * An empty `smtp.host` means "no SMTP transport": email is written to the log
   * instead, which keeps the verification and reset flows drivable without a mail
   * server. `.env.example` sets it to the local-catcher convention
   * (`localhost:1025` — Mailhog and Mailpit both listen there).
   *
   * ## Credentials are Layer 1 here, and the design says they should be Layer 2
   *
   * Everything below is read from the environment, so rotating an SMS key needs a
   * redeploy. [13-runtime-configuration.md](../../../docs/13-runtime-configuration.md)
   * puts `notification.sms.apiKey` and friends in `platform_setting`, where an
   * operator rotates them live — and that is the right home for a credential that
   * a provider may force you to change at an inconvenient hour. It is not
   * implemented: the transports read this accessor directly. Recorded here rather
   * than left as a comment that claims the plumbing exists.
   */
  get notifications() {
    return {
      smtp: {
        host: this.raw.SMTP_HOST,
        port: this.raw.SMTP_PORT,
        user: this.raw.SMTP_USER,
        password: this.raw.SMTP_PASSWORD,
        from: this.raw.SMTP_FROM,
      },
      sms: {
        provider: this.raw.SMS_PROVIDER,
        apiKey: this.raw.SMS_API_KEY,
        senderId: this.raw.SMS_SENDER_ID,
        twilioAccountSid: this.raw.TWILIO_ACCOUNT_SID,
      },
    } as const;
  }

  // ------------------------------------------------------ observability

  get observability() {
    return {
      otelEnabled: this.raw.OTEL_ENABLED,
      otelEndpoint: this.raw.OTEL_EXPORTER_OTLP_ENDPOINT,
      sentryDsn: this.raw.SENTRY_DSN,
    } as const;
  }

  // ------------------------------------------------------ feature flags

  /** Bootstrap defaults only. Runtime values live in the `feature_flag` table. */
  get bootstrapFlags(): Readonly<Record<string, boolean>> {
    return {
      FF_MOBILE_APP_ENABLED: this.raw.FF_MOBILE_APP_ENABLED,
      FF_ONLINE_PAYMENTS_ENABLED: this.raw.FF_ONLINE_PAYMENTS_ENABLED,
      FF_CREDIT_ORDERS_ENABLED: this.raw.FF_CREDIT_ORDERS_ENABLED,
      FF_MULTI_WAREHOUSE: this.raw.FF_MULTI_WAREHOUSE,
      FF_SALT_SMART_SUGGEST: this.raw.FF_SALT_SMART_SUGGEST,
    };
  }
}
