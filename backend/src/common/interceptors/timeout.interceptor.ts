import {
  Injectable,
  RequestTimeoutException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { TimeoutError, throwError, type Observable } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/**
 * Caps how long any single request may occupy a connection.
 *
 * A hung upstream call — a payment gateway that accepts the socket and never
 * replies, a search cluster mid-failover — otherwise holds a Node event-loop
 * slot and a database connection until the client gives up. Under load these
 * accumulate and the pod stops serving anything at all. A timeout converts an
 * unbounded hang into a fast, retryable failure.
 *
 * This is a *safety net*, not the primary control. The database enforces its own
 * `statement_timeout` (see `DATABASE_STATEMENT_TIMEOUT_MS`), and every outbound
 * HTTP client sets its own deadline. The value here is deliberately the largest
 * of the three so that a slow-but-legitimate query surfaces with its own
 * diagnostic message rather than being cut off here.
 *
 * Long-running work belongs in a queue, not in a request. Anything that
 * genuinely needs minutes — report exports, bulk imports, invoice generation —
 * returns `202 Accepted` with a job id and is polled.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException({
                message: `The request exceeded the ${this.timeoutMs} ms limit and was aborted.`,
                errors: [
                  {
                    field: '_request',
                    code: 'REQUEST_TIMEOUT',
                    message: 'Retry with a narrower query, or use the asynchronous job endpoint.',
                  },
                ],
              }),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
