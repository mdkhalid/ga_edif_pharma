import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import type { ErrorCode, FieldError, ProblemDetails } from '@medichain/shared-types';
import { ErrorCode as Codes } from '@medichain/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import { requestContext } from '../context/request-context';
import { DomainException } from '../exceptions/domain.exception';
import { AppLogger } from '../logger/app-logger.service';

/** Maps a bare HTTP status to our stable error code vocabulary. */
const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: Codes.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: Codes.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: Codes.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: Codes.NOT_FOUND,
  [HttpStatus.CONFLICT]: Codes.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: Codes.BUSINESS_RULE_VIOLATION,
  [HttpStatus.TOO_MANY_REQUESTS]: Codes.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: Codes.DEPENDENCY_UNAVAILABLE,
  // Numeric literals rather than `HttpStatus.*`: Nest's enum omits these two
  // members even though the statuses are standard, and importing them from
  // elsewhere to satisfy a map key would obscure where the value comes from.
  413: Codes.VALIDATION_FAILED, // Payload Too Large
  426: Codes.UPGRADE_REQUIRED, // Upgrade Required
};

const PROBLEM_BASE = 'https://api.medichain.example/problems';

/**
 * Converts every thrown value into RFC 9457 `application/problem+json`.
 *
 * One shape, always. Clients have exactly one error parser, and adding a new
 * domain error never requires a client change because the shape is fixed and
 * the `errors[].code` values are stable.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLogger,
    private readonly config: AppConfigService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const context = requestContext.get();

    const problem = this.toProblemDetails(exception, request);

    // Log at a level that matches the severity. A 404 is not an error worth
    // paging anyone for; a 500 always is.
    const logPayload = {
      status: problem.status,
      code: problem.type.split('/').pop(),
      path: request.url,
      method: request.method,
      correlationId: context?.correlationId,
      exception: exception instanceof Error ? exception.name : typeof exception,
      detail: problem.detail,
      ...(problem.status >= 500 && exception instanceof Error
        ? { stack: exception.stack }
        : {}),
    };

    if (problem.status >= 500) {
      this.logger.error(`${request.method} ${request.url} -> ${problem.status}`, logPayload);
    } else if (problem.status >= 400 && problem.status !== 404) {
      this.logger.warn(`${request.method} ${request.url} -> ${problem.status}`, logPayload);
    }

    response.status(problem.status).json(problem);
  }

  private toProblemDetails(exception: unknown, request: Request): ProblemDetails {
    const context = requestContext.get();
    const base = {
      instance: request.url,
      correlationId: context?.correlationId,
      timestamp: new Date().toISOString(),
    };

    // ---- our own errors: the status and code are already correct
    if (exception instanceof DomainException) {
      return {
        type: `${PROBLEM_BASE}/${exception.code.toLowerCase().replace(/_/g, '-')}`,
        title: exception.name,
        status: exception.httpStatus,
        detail: exception.message,
        ...base,
        ...(exception.meta !== undefined ? { meta: exception.meta } : {}),
      } as ProblemDetails;
    }

    // ---- request validation (class-validator via ValidationPipe)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const fieldErrors = this.extractFieldErrors(body);

      return {
        type: `${PROBLEM_BASE}/${(STATUS_TO_CODE[status] ?? Codes.INTERNAL_ERROR).toLowerCase().replace(/_/g, '-')}`,
        title: exception.name,
        status,
        detail: this.extractMessage(body, exception.message),
        ...base,
        ...(fieldErrors.length > 0 ? { errors: fieldErrors } : {}),
      };
    }

    // ---- Zod (env validation, ad-hoc parsing)
    if (exception instanceof ZodError) {
      return {
        type: `${PROBLEM_BASE}/validation-failed`,
        title: 'ValidationFailed',
        status: HttpStatus.BAD_REQUEST,
        detail: 'The request payload failed validation.',
        ...base,
        errors: exception.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          code: Codes.VALIDATION_FAILED,
          message: issue.message,
        })),
      };
    }

    // ---- Prisma: translate the constraint violations we care about
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception, base);
    }

    // ---- anything else: never leak internals to the client
    return {
      type: `${PROBLEM_BASE}/internal-error`,
      title: 'InternalServerError',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: this.config.isProduction
        ? 'An unexpected error occurred. The issue has been logged.'
        : exception instanceof Error
          ? exception.message
          : String(exception),
      ...base,
    };
  }

  private fromPrismaError(
    error: Prisma.PrismaClientKnownRequestError,
    base: { instance: string; correlationId: string | undefined; timestamp: string },
  ): ProblemDetails {
    switch (error.code) {
      case 'P2002': {
        const target = error.meta?.['target'];
        const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'field');
        return {
          type: `${PROBLEM_BASE}/conflict`,
          title: 'UniqueConstraintViolation',
          status: HttpStatus.CONFLICT,
          detail: `A record with this ${fields} already exists.`,
          ...base,
        };
      }
      case 'P2025':
        return {
          type: `${PROBLEM_BASE}/not-found`,
          title: 'RecordNotFound',
          status: HttpStatus.NOT_FOUND,
          detail: 'The requested record does not exist.',
          ...base,
        };
      case 'P2003':
        return {
          type: `${PROBLEM_BASE}/business-rule-violation`,
          title: 'ForeignKeyViolation',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          detail: 'A referenced record does not exist.',
          ...base,
        };
      default:
        this.logger.error(`Unmapped Prisma error ${error.code}`, { code: error.code, meta: error.meta });
        return {
          type: `${PROBLEM_BASE}/internal-error`,
          title: 'DatabaseError',
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          detail: 'A database error occurred. The issue has been logged.',
          ...base,
        };
    }
  }

  /** Pulls `errors[]` out of a Nest ValidationPipe response. */
  private extractFieldErrors(body: unknown): FieldError[] {
    if (typeof body !== 'object' || body === null) return [];

    const messages = (body as { message?: unknown }).message;
    if (!Array.isArray(messages)) return [];

    return messages
      .filter((item): item is string => typeof item === 'string')
      .map((message) => {
        // class-validator messages look like "fieldName must be a string"
        const [field] = message.split(' ');
        return {
          field: field ?? '(root)',
          code: Codes.VALIDATION_FAILED,
          message,
        };
      });
  }

  private extractMessage(body: unknown, fallback: string): string {
    if (typeof body === 'string') return body;
    if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    }
    return fallback;
  }
}
