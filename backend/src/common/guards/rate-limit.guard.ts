import {
  CanActivate,
  Inject,
  Injectable,
  Logger,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppConfigService } from '../../config/app-config.service';
import { META, RATE_LIMIT_BUCKET, type RateLimitBucket } from '../constants/metadata';
import { requestContext } from '../context/request-context';
import { RateLimitedError } from '../exceptions/domain.exception';
import { RATE_LIMITER, type RateLimiter } from '../ports/rate-limiter.port';
import type { RateLimitOptions } from '../decorators/rate-limit.decorator';

/**
 * Applies the route's rate limit.
 *
 * Registered globally so every route has a budget by default; `@RateLimit()`
 * only ever *narrows* it.
 *
 * ## Why the counter lives in Redis, not in the process
 *
 * A per-process counter multiplied by the pod count is the classic limiter bug:
 * a "10 requests per minute" login limit becomes "120 per minute" behind a
 * twelve-pod deployment, and the number silently changes every time the
 * autoscaler adds a replica. The limit must be a property of the system, not of
 * whichever pod happened to receive the request.
 *
 * ## Why the key is composite
 *
 * Limiting on IP alone punishes an entire mobile carrier's NAT — thousands of
 * pharmacies share one egress address, so one bad actor locks out everyone.
 * Limiting on user alone is unavailable before authentication, which is exactly
 * when limiting matters most. `ip+identifier` covers the auth routes: it lets an
 * attacker hammer a single account up to the limit and no further, without
 * letting them degrade service for unrelated users behind the same NAT.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const settings = this.config.rateLimit;
    if (!settings.enabled) return true;

    const override = this.reflector.getAllAndOverride<RateLimitOptions>(META.RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);

    const bucket: RateLimitBucket = override?.bucket ?? RATE_LIMIT_BUCKET.DEFAULT;
    const max = override?.max ?? this.defaultMaxFor(bucket);
    const windowSeconds = override?.windowSeconds ?? settings.windowSeconds;
    const keyBy = override?.keyBy ?? (bucket === RATE_LIMIT_BUCKET.AUTH ? 'ip+identifier' : 'ip');

    const http = context.switchToHttp();
    const request = http.getRequest<{
      ip?: string;
      headers?: Record<string, unknown>;
      body?: unknown;
    }>();
    const response = http.getResponse<{ setHeader?: (name: string, value: string) => void }>();

    const subject = this.resolveSubject(keyBy, request);
    const key = `ratelimit:${bucket}:${subject}`;

    let decision;
    try {
      decision = await this.limiter.consume(key, max, windowSeconds);
    } catch (error) {
      // Fail open (ADR-014). If Redis is unreachable the API must keep serving;
      // the limiter is a capacity control, not an authorisation control.
      this.logger.warn(
        `Rate limiter unavailable; allowing the request. ${error instanceof Error ? error.message : ''}`,
      );
      return true;
    }

    response.setHeader?.('X-RateLimit-Limit', String(decision.limit));
    response.setHeader?.('X-RateLimit-Remaining', String(Math.max(0, decision.remaining)));
    response.setHeader?.('X-RateLimit-Reset', String(decision.resetAfterSeconds));

    if (!decision.allowed) {
      response.setHeader?.('Retry-After', String(decision.resetAfterSeconds));
      throw new RateLimitedError(decision.resetAfterSeconds, decision.limit);
    }

    return true;
  }

  /**
   * Bucket ceilings come from configuration so they can be tuned per environment
   * without a code change. Search is given its own, smaller budget because it is
   * the most expensive endpoint per request and the easiest to abuse.
   */
  private defaultMaxFor(bucket: RateLimitBucket): number {
    const settings = this.config.rateLimit;
    switch (bucket) {
      case RATE_LIMIT_BUCKET.AUTH:
      case RATE_LIMIT_BUCKET.OTP:
        return settings.authMax;
      case RATE_LIMIT_BUCKET.SEARCH:
        return settings.searchMax;
      case RATE_LIMIT_BUCKET.EXPORT:
        return Math.max(1, Math.floor(settings.defaultMax / 30));
      default:
        return settings.defaultMax;
    }
  }

  private resolveSubject(
    keyBy: NonNullable<RateLimitOptions['keyBy']>,
    request: { ip?: string; headers?: Record<string, unknown>; body?: unknown },
  ): string {
    const context = requestContext.get();
    const ip = context?.ip ?? request.ip ?? 'unknown';
    const userId = context?.principal?.userId;
    const tenantId = context?.tenantId;

    switch (keyBy) {
      case 'user':
        // Pre-auth there is no user, so fall back to the IP rather than putting
        // every anonymous caller in one shared bucket.
        return userId !== undefined ? `user:${userId}` : `ip:${ip}`;
      case 'tenant':
        return tenantId !== null && tenantId !== undefined ? `tenant:${tenantId}` : `ip:${ip}`;
      case 'ip+identifier': {
        const identifier = readIdentifier(request.body);
        return identifier === null ? `ip:${ip}` : `ip:${ip}|id:${identifier}`;
      }
      case 'ip':
      default:
        return `ip:${ip}`;
    }
  }
}

/**
 * Extracts the account identifier from an auth request body.
 *
 * Normalised to lowercase and trimmed so that `Admin@Example.com` and
 * `admin@example.com ` share one bucket — otherwise an attacker bypasses the
 * limit by varying the case of the address they are attacking.
 */
function readIdentifier(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;

  const record = body as Record<string, unknown>;
  const raw = record['email'] ?? record['phone'] ?? record['identifier'];
  if (typeof raw !== 'string') return null;

  const normalised = raw.trim().toLowerCase();
  return normalised === '' ? null : normalised;
}
