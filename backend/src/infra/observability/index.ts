import { Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { initSentry } from './sentry';
import { isTracingStarted } from './tracing';

/**
 * Public surface of the observability infrastructure.
 *
 * Imported by `main.ts` and the root module. Tracing is *started* by
 * `tracing-preload.ts`, not here — see that file for why.
 */
export { ObservabilityModule } from './observability.module';
export { MetricsService } from './metrics.service';
export { MetricsInterceptor } from './metrics.interceptor';
export { SentryErrorReporter } from './sentry-error-reporter';
export { captureException, initSentry, isSentryEnabled } from './sentry';
export { isTracingStarted, shutdownTracing, startTracing } from './tracing';
export { ERROR_REPORTER } from '../../common/ports/error-reporter.port';
export type { ErrorReporter, ErrorReportContext } from '../../common/ports/error-reporter.port';

/**
 * Initialises the reporters that depend on validated configuration.
 *
 * Sentry needs the DSN from configuration, so it is initialised here rather than
 * in the preload. Tracing is only *verified*: if the operator asked for it but
 * the preload did not run, the auto-instrumentation is incomplete, and saying so
 * once at boot is far better than a silent gap in the traces.
 */
export function initObservability(config: AppConfigService): void {
  const logger = new Logger('Observability');
  const { otelEnabled, sentryDsn } = config.observability;

  const sentryEnabled = initSentry({
    dsn: sentryDsn,
    environment: config.nodeEnv,
    release: process.env['APP_VERSION'],
  });

  const tracingEnabled = isTracingStarted();

  if (otelEnabled && !tracingEnabled) {
    logger.warn(
      'OTEL_ENABLED is true but the tracing preload did not run, so auto-instrumentation is ' +
        'incomplete. Start the process with: ' +
        'node -r ./dist/infra/observability/tracing-preload.js dist/main.js',
    );
  }

  logger.log(
    `Observability initialised — metrics: on, traces: ${tracingEnabled ? 'on' : 'off'}, ` +
      `error reporting: ${sentryEnabled ? 'on' : 'off'}.`,
  );
}
