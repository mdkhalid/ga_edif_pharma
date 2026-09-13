/**
 * Error-reporting port.
 *
 * The exception filter lives in `common/` (the shared kernel) and must not reach
 * into `infra/` — the same rule the rate-limiter and idempotency ports exist to
 * keep. Declaring *what* the filter needs here and *how* it is implemented in
 * `infra/observability/` means Sentry can be swapped for another reporter (or
 * disabled entirely) as a module-binding change, and a unit test can bind the
 * token to a spy instead of initialising a real Sentry client.
 */

export const ERROR_REPORTER = Symbol('ErrorReporter');

/** Extra context attached to a reported error, for grouping and triage. */
export interface ErrorReportContext {
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly path?: string;
  readonly method?: string;
  readonly status?: number;
  readonly [key: string]: unknown;
}

export interface ErrorReporter {
  /**
   * Reports an error that the application did not expect.
   *
   * Implementations must never throw: a reporting failure must not compound the
   * original error, and must never change the response the client receives.
   */
  report(error: unknown, context?: ErrorReportContext): void;
}
