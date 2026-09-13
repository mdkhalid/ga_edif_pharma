import * as Sentry from '@sentry/node';

let initialized = false;

export interface SentryOptions {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string;
}

/**
 * Initialises Sentry error reporting.
 *
 * Returns `false` and does nothing when no DSN is configured — the default in
 * local development and CI. An unconfigured reporter must be inert, not a
 * startup failure: the absence of an error tracker is not a reason the API
 * cannot serve.
 *
 * `tracesSampleRate` is deliberately `0`. Traces are OpenTelemetry's job (see
 * `tracing.ts`); running two tracing systems over the same requests doubles the
 * cost and yields two partial pictures nobody reconciles.
 */
export function initSentry(options: SentryOptions): boolean {
  if (options.dsn.trim() === '') return false;

  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: 0,
    // Request bodies on this system carry passwords, OTPs and prescription data.
    // Sentry must not receive them, so default PII collection stays off.
    sendDefaultPii: false,
  });

  initialized = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

/**
 * Reports an error, tolerating a reporter that is disabled or failing.
 *
 * Never throws: an error tracker that takes down the request path while
 * reporting the error that broke it is worse than no error tracker.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;

  try {
    Sentry.withScope((scope) => {
      if (context !== undefined) scope.setExtras(context);
      Sentry.captureException(error);
    });
  } catch {
    // Swallowed on purpose — see the method note.
  }
}
