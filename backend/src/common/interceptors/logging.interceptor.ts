import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';

import { requestContext } from '../context/request-context';
import { AppLogger } from '../logger/app-logger.service';
import { statusOfError } from '../utils/error-status.util';

/**
 * Logs one line per completed request: method, path, status, duration.
 *
 * ## Why the status is read after the fact
 *
 * `response.statusCode` is only meaningful once the handler (or the exception
 * filter) has set it, so the log runs in the `tap`'s next/error branches rather
 * than on entry. Logging on entry alone cannot report outcome, and outcome is
 * the only part anyone greps for.
 *
 * ## Why the route pattern, not the URL
 *
 * `/api/v1/orders/8f3c-…` produces one log line per order — useless for
 * aggregation and a slow way to fill a log index. `request.route?.path` gives
 * `/api/v1/orders/:id`, which groups correctly. The concrete URL is still
 * available in the trace, keyed by request id.
 *
 * ## Why the body is never logged
 *
 * Request bodies on this system contain passwords, OTPs, refresh tokens and
 * patient prescription data. The logger redacts known-sensitive keys, but the
 * only reliable rule is to not pass bodies to it at all.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<{
      method?: string;
      originalUrl?: string;
      route?: { path?: string };
    }>();
    const response = http.getResponse<{ statusCode?: number }>();

    const context_ = requestContext.get();
    const startedAt = context_?.startedAt ?? Date.now();
    const method = request.method ?? 'UNKNOWN';
    const path = request.route?.path ?? request.originalUrl ?? 'unknown';

    const emit = (outcome: 'ok' | 'error', error?: unknown): void => {
      const durationMs = Date.now() - startedAt;
      const status = outcome === 'ok' ? (response.statusCode ?? 200) : statusOfError(error);

      const fields = {
        method,
        path,
        status,
        durationMs,
        requestId: context_?.requestId,
        correlationId: context_?.correlationId,
        tenantId: context_?.tenantId ?? undefined,
        userId: context_?.principal?.userId,
      };

      // 5xx is an operational event; 4xx is expected client behaviour and would
      // otherwise drown the signal at one warning per bot request.
      if (status >= 500) this.logger.error(`← ${status} ${method} ${path}`, undefined, fields);
      else if (status >= 400) this.logger.warn(`← ${status} ${method} ${path}`, fields);
      else this.logger.log(`← ${status} ${method} ${path}`, fields);
    };

    return next.handle().pipe(
      tap({
        next: () => emit('ok'),
        error: (error: unknown) => emit('error', error),
      }),
    );
  }
}
