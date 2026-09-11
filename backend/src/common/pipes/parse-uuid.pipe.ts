import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates and normalises a UUID route parameter.
 *
 * Rejecting a malformed id at the boundary means a typo returns a clear 400
 * rather than a Prisma error that surfaces as a 500. It also prevents a
 * hand-crafted id from reaching a query that assumes well-formed input.
 *
 * Normalising to lowercase matters because ids arrive from URLs and from
 * case-insensitive database lookups; comparing `A1B2…` to `a1b2…` in JavaScript
 * would report "not found" for a row that exists.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  constructor(private readonly parameterName = 'id') {}

  transform(value: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new BadRequestException({
        message: 'Request validation failed.',
        errors: [
          {
            field: this.parameterName,
            code: 'isUuid',
            message: `${this.parameterName} must be a valid UUID.`,
          },
        ],
      });
    }
    return value.toLowerCase();
  }
}

/** Convenience factory: `@Param('orderId', uuidParam('orderId'))`. */
export function uuidParam(parameterName = 'id'): ParseUuidPipe {
  return new ParseUuidPipe(parameterName);
}
