import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { createRequestContext, requestContext } from './request-context';

/** Reads a header that may be absent, a string, or a repeated header array. */
function readHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value.length > 0 ? value : null;
}

/**
 * Establishes the AsyncLocalStorage context for every request.
 *
 * Must be the FIRST middleware in the chain: everything downstream — logging,
 * tenant scoping, audit — reads from the context this sets.
 *
 * Correlation ids are echoed back on the response so a user reporting "the order
 * failed at 3:15" can be traced to a single log line, trace and set of queries.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incomingRequestId = readHeader(req.headers['x-request-id']);
    const incomingCorrelationId = readHeader(req.headers['x-correlation-id']);

    const requestId = incomingRequestId ?? randomUUID();
    const correlationId = incomingCorrelationId ?? requestId;

    const context = createRequestContext({
      requestId,
      correlationId,
      ip: this.resolveClientIp(req),
      userAgent: readHeader(req.headers['user-agent']),
    });

    // Echoed so clients and the load balancer can log the same identifier.
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', correlationId);

    requestContext.run(context, () => {
      next();
    });
  }

  /**
   * Resolves the caller IP.
   *
   * `X-Forwarded-For` is only trusted when the app is behind a known proxy —
   * Express populates `req.ip` from it when `trust proxy` is configured. Reading
   * the raw header unconditionally would let any client forge its own IP and
   * defeat IP-based rate limiting.
   */
  private resolveClientIp(req: Request): string | null {
    const expressIp = req.ip;
    if (typeof expressIp === 'string' && expressIp.length > 0) return expressIp;

    const socketIp = req.socket?.remoteAddress;
    return typeof socketIp === 'string' ? socketIp : null;
  }
}
