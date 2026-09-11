import { Injectable, type LoggerService, type OnModuleDestroy } from '@nestjs/common';
import pino, { type Logger } from 'pino';

import { AppConfigService } from '../../config/app-config.service';
import { requestContext } from '../context/request-context';

/**
 * Keys whose values must never reach a log sink.
 *
 * Redaction is an allow-list in reverse: anything matching is dropped by
 * default, and logging a sensitive field requires deliberately renaming it.
 * Opting *in* to logging a secret should be a reviewed act, not an oversight.
 */
const SENSITIVE_KEY_PATTERN =
  /pass(word|wd)?|secret|token|otp|card|cvv|authorization|api[_-]?key|private[_-]?key|encryption[_-]?key|credit[_-]?card|session[_-]?id/i;

const REDACTED = '[REDACTED]';
const MAX_SCRUB_DEPTH = 6;

/**
 * Recursively redacts sensitive keys and normalises Error values.
 *
 * pino's built-in `redact` only handles known paths; our log payloads are
 * dynamic (entity diffs, webhook bodies), so a walk is the only reliable option.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return '[max-depth]';
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause !== undefined ? { cause: scrub(value.cause, depth + 1) } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrub(nested, depth + 1);
    }
    return output;
  }

  return value;
}

/** Pulls a message and optional metadata out of Nest's varied call signatures. */
function normaliseArgs(args: unknown[]): { message: string; meta: Record<string, unknown> } {
  const [first, ...rest] = args;

  let message: string;
  if (typeof first === 'string') {
    message = first;
  } else if (first instanceof Error) {
    message = first.message;
  } else {
    message = String(first);
  }

  const meta: Record<string, unknown> = {};
  rest.forEach((item, index) => {
    if (item === undefined) return;
    meta[`arg${index}`] = item;
  });

  return { message, meta };
}

/**
 * Structured JSON logger.
 *
 * Every line carries the request's correlation id, so "the order failed at
 * 3:15" resolves to one query rather than a grep across four services.
 */
@Injectable()
export class AppLogger implements LoggerService, OnModuleDestroy {
  private readonly logger: Logger;

  constructor(private readonly config: AppConfigService) {
    const isPretty = this.config.isDevelopment && !this.config.isTest;

    this.logger = pino({
      level: this.config.logLevel,
      base: {
        service: this.config.appName.toLowerCase().replace(/\s+/g, '-'),
        env: this.config.nodeEnv,
        role: this.config.appRole,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      ...(isPretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname,service,env,role',
              },
            },
          }
        : {}),
    });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  /** Child logger with bound fields, e.g. `logger.child({ orderId })`. */
  child(bindings: Record<string, unknown>): Logger {
    return this.logger.child(scrub(bindings) as Record<string, unknown>);
  }

  async onModuleDestroy(): Promise<void> {
    // Flush buffered records before the process exits, so a crash does not lose
    // the log line that explains it.
    await new Promise<void>((resolve) => {
      this.logger.flush(() => resolve());
    });
  }

  private write(level: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal', message: unknown, params: unknown[]): void {
    const { message: text, meta } = normaliseArgs([message, ...params]);
    const context = requestContext.get();

    const payload: Record<string, unknown> = {
      ...(scrub(meta) as Record<string, unknown>),
      msg: text,
    };

    if (context !== undefined) {
      payload['requestId'] = context.requestId;
      payload['correlationId'] = context.correlationId;
      if (context.tenantId !== null) payload['tenantId'] = context.tenantId;
      if (context.principal !== null) payload['userId'] = context.principal.userId;
    }

    this.logger[level](payload);
  }
}
