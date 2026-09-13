import { Injectable } from '@nestjs/common';

import type { ErrorReporter, ErrorReportContext } from '../../common/ports/error-reporter.port';
import { captureException, isSentryEnabled } from './sentry';

/**
 * `ErrorReporter` backed by Sentry.
 *
 * A thin adapter with one job: keep Sentry's API from leaking into `common/`.
 * The exception filter depends on the `ErrorReporter` interface, so replacing
 * Sentry with another vendor (or a no-op in tests) touches this file and a module
 * binding, not the filter.
 */
@Injectable()
export class SentryErrorReporter implements ErrorReporter {
  report(error: unknown, context?: ErrorReportContext): void {
    if (!isSentryEnabled()) return;
    captureException(error, context);
  }
}
