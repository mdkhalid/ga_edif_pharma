import {
  Injectable,
  InternalServerErrorException,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';

import { META } from '../constants/metadata';

/**
 * Enforces the documented response shape (docs/07 §5).
 *
 * It is deliberately **not** a blanket `{ data: ... }` wrapper. The API
 * convention is:
 *
 * | Handler returns            | Client receives              |
 * |----------------------------|------------------------------|
 * | a single resource          | the resource, unwrapped      |
 * | `Paginated<T>`             | `{ data, meta }`             |
 * | `ApiResponse<T>`           | `{ data, message? }`         |
 *
 * Wrapping everything would produce `{ data: { data, meta } }` for every list
 * and force clients to unwrap twice, so instead this interceptor *guards* the
 * convention. Its one real job is the rule the API doc calls "bounded by
 * default": a handler must never return a bare array.
 *
 * A bare array means someone wrote `return this.repo.findMany()` and the
 * response size is whatever the table happens to contain — which works on a
 * seed database and takes the pod out of memory at 200 000 products. Returning
 * one is a bug, so it fails loudly in development and CI. In production it is
 * logged and wrapped rather than thrown, because turning a formatting mistake
 * into a 500 for real users is worse than serving a page-shaped response.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  private readonly logger = new Logger(TransformInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    const rawResponse = this.reflector.getAllAndOverride<boolean>(META.RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((payload) => {
        if (rawResponse === true) return payload;
        if (!Array.isArray(payload)) return payload;

        const route = `${context.getClass().name}.${context.getHandler().name}`;
        const message =
          `Handler ${route} returned a bare array. Every collection endpoint must return ` +
          'Paginated<T> so the response is bounded — see docs/07 §4.';

        if (process.env['NODE_ENV'] === 'production') {
          this.logger.error(message);
          return { data: payload, meta: { limit: payload.length, nextCursor: null, hasNext: false } };
        }

        throw new InternalServerErrorException(message);
      }),
    );
  }
}
