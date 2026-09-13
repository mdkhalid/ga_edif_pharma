import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';

import { statusOfError } from '../../common/utils/error-status.util';
import { MetricsService } from './metrics.service';

interface MetricsRequest {
  method?: string;
  originalUrl?: string;
  route?: { path?: string };
}

/**
 * Records request rate and duration for every route.
 *
 * This is the RED method (Rate, Errors, Duration) applied uniformly: because it
 * is registered globally, a new endpoint is measured the moment it exists, with
 * no per-controller instrumentation to remember. A metric that has to be added
 * by hand is a metric that is missing on precisely the endpoint someone forgot.
 *
 * Duration is read with `process.hrtime.bigint()`, not `Date.now()`: wall-clock
 * time can jump backwards on an NTP correction and produce a negative duration,
 * which poisons the histogram. A monotonic clock cannot.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<MetricsRequest>();
    const response = http.getResponse<{ statusCode?: number }>();

    const method = request.method ?? 'UNKNOWN';
    const route = request.route?.path ?? request.originalUrl ?? 'unknown';
    const startedAt = process.hrtime.bigint();

    const record = (status: number): void => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.observe(method, route, status, durationSeconds);
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode ?? 200),
        error: (error: unknown) => record(statusOfError(error)),
      }),
    );
  }
}
