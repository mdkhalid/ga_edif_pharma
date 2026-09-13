import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './infra/cache/cache.module';

import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggerModule } from './common/logger/logger.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantScopeGuard } from './common/guards/tenant-scope.guard';
import { CapabilityGuard } from './common/guards/capability.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { MetricsInterceptor, ObservabilityModule } from './infra/observability';

// Feature modules are reached through their public barrels, never by deep
// import — see `scripts/check-module-boundaries.mjs`.
import { AuditModule } from './modules/audit';
import { HealthModule } from './modules/health';
import { IamModule } from './modules/iam';

/**
 * Root module.
 *
 * ## Everything security-relevant is registered globally, on purpose
 *
 * Guards, the exception filter, the validation pipe and the interceptors are
 * attached with `APP_*` tokens rather than per controller. The distinction is
 * not stylistic:
 *
 *   - A globally registered guard applies to every route, including ones added
 *     next year by someone who has not read this file.
 *   - A `@UseGuards()` on each controller applies only where it was remembered.
 *     The controller that forgot it is the one that leaks data, and nothing in
 *     review reliably catches its absence.
 *
 * The system fails closed. `@Public()` is the deliberate, greppable exception.
 *
 * ## Guard order
 *
 * Nest executes `APP_GUARD` providers in registration order, and the order below
 * is load-bearing:
 *
 *   1. **RateLimitGuard** — cheapest, and it must run before anything expensive.
 *      A flood of unauthenticated requests should be rejected before the system
 *      does cryptographic work to discover they are unauthenticated.
 *   2. **JwtAuthGuard** — establishes *who* the caller is.
 *   3. **TenantScopeGuard** — establishes *which tenant* the request operates on.
 *      After authentication, because the tenant comes from the principal.
 *   4. **CapabilityGuard** — establishes *what* the caller may do. Last, because
 *      it is meaningless until identity and scope are known.
 *
 * Reordering 2 and 3 would make the tenant scope check run before a principal
 * exists; reordering 3 and 4 would authorise before knowing the tenant, which is
 * how a capability check passes for the wrong tenant's data.
 *
 * ## Interceptor order
 *
 * The first registered is the outermost, so the chain below measures the full
 * request duration (logging), enforces a deadline (timeout), replays a repeated
 * `@Idempotent()` request before it reaches the handler (idempotency), and only
 * then lets the handler's raw return value reach the shape guard (transform).
 */
@Module({
  imports: [
    // Configuration first: everything else depends on validated environment.
    AppConfigModule,
    // Global infrastructure.
    LoggerModule,
    DatabaseModule,
    CacheModule,
    ObservabilityModule,
    // Cross-cutting feature modules.
    AuditModule,
    // HTTP-facing modules.
    HealthModule,
    IamModule,
  ],
  providers: [
    // ---------------------------------------------------------------- pipes
    {
      provide: APP_PIPE,
      // The policy lives in one factory so no controller can restate it
      // differently — see `createValidationPipe` for why each option is set.
      useFactory: () => createValidationPipe(),
    },

    // --------------------------------------------------------------- guards
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantScopeGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },

    // --------------------------------------------------------- interceptors
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // Immediately inside logging, so the recorded duration covers the whole
    // chain — including a timeout or an idempotency replay.
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    {
      provide: APP_INTERCEPTOR,
      // Deliberately above the database's own `statement_timeout` so a slow
      // query surfaces with its own diagnostic rather than being cut off here.
      useFactory: () => new TimeoutInterceptor(30_000),
    },
    // Outside TransformInterceptor, so the value it stores for replay is the
    // final response shape the client actually received — a replay then returns
    // byte-identical output rather than re-wrapping it.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },

    // --------------------------------------------------------------- filter
    // Registered last so it wraps everything: any error raised anywhere in the
    // chain above — a guard, an interceptor, a pipe, a handler — reaches it.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  /**
   * The request context middleware runs first in the chain.
   *
   * It must, because every guard, interceptor and logger reads from the context
   * it populates. A request that reached a guard without a context would fail at
   * `requestContext.require()` with a confusing error, and the tenant-scoping
   * extension would refuse to run the query.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
