import { Global, Module } from '@nestjs/common';

import { ERROR_REPORTER } from '../../common/ports/error-reporter.port';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { SentryErrorReporter } from './sentry-error-reporter';

/**
 * Metrics endpoint and error reporting.
 *
 * `@Global()` for the same reason as the database and cache modules: it is
 * universal infrastructure with no per-consumer configuration, and the exception
 * filter — registered in the root module — needs `ERROR_REPORTER` without every
 * feature module importing this one.
 *
 * `ERROR_REPORTER` is bound to a token rather than the concrete class so the
 * filter depends on the interface: a test binds the token to a spy and asserts
 * that a 5xx is reported, with no Sentry client involved.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    SentryErrorReporter,
    { provide: ERROR_REPORTER, useExisting: SentryErrorReporter },
  ],
  exports: [MetricsService, ERROR_REPORTER],
})
export class ObservabilityModule {}
