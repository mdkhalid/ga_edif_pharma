import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../infra/cache/redis.service';

/**
 * Dependency health checks.
 *
 * ## Liveness and readiness are different questions
 *
 * Conflating them is the classic Kubernetes mistake and it causes outages rather
 * than preventing them:
 *
 *   - **Liveness** — "is this process still able to make progress?" A failure
 *     means the orchestrator should kill and restart the container. Only a
 *     condition that a restart can fix belongs here. A database outage is *not*
 *     one: restarting every pod will not bring Postgres back, and a liveness
 *     probe that fails on a dependency turns a database blip into a full
 *     crash-loop that also destroys the in-flight work of every pod at once.
 *
 *   - **Readiness** — "should this pod receive traffic right now?" A failure
 *     means take it out of the load-balancer pool but leave it running. A
 *     database outage *does* belong here: the pod cannot serve requests, so
 *     sending it traffic produces user-visible 500s instead of a fast failure
 *     the load balancer can route around.
 *
 * So `/health/live` checks only the process, and `/health/ready` checks the
 * dependencies.
 *
 * ## Required versus optional dependencies
 *
 * Postgres is required: without it the API can serve nothing.
 *
 * Redis is optional by design (ADR-014). It backs the cache, the rate limiter
 * and the idempotency store, and every one of those has a defined degraded
 * behaviour — cache misses, fail-open limiting, and a database-backed
 * idempotency fallback. Reporting unready when Redis is down would take the
 * whole fleet out of service to protect a dependency the system is explicitly
 * built to survive without. It is reported as `degraded` instead: visible to
 * operators, not fatal to traffic.
 */

export type HealthStatus = 'ok' | 'degraded' | 'unavailable';

export interface DependencyCheck {
  readonly status: 'up' | 'down';
  readonly latencyMs: number | null;
  readonly required: boolean;
  readonly message?: string;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly service: string;
  readonly role: string;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  readonly checks: Readonly<Record<string, DependencyCheck>>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Liveness: the process is running and the event loop is responsive.
   *
   * Intentionally checks nothing else. If this endpoint can answer at all, the
   * process is alive, and a restart would not improve a dependency problem.
   */
  live(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: can this pod serve traffic?
   *
   * Checks run concurrently. Sequential checks would make the probe's latency
   * the sum of every dependency's timeout, which for a probe that runs every few
   * seconds is a meaningful cost — and it delays the 503 that lets the load
   * balancer route around a sick pod.
   */
  async ready(): Promise<HealthReport> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);

    const checks = { postgres, redis };
    const status = this.aggregate(checks);

    if (status === 'unavailable') {
      this.logger.error(
        `Readiness failed: ${Object.entries(checks)
          .filter(([, check]) => check.status === 'down' && check.required)
          .map(([name]) => name)
          .join(', ')} unavailable.`,
      );
    }

    return {
      status,
      service: this.config.appName,
      role: this.config.appRole,
      version: process.env['APP_VERSION'] ?? '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /**
   * A required dependency being down makes the pod unready. An optional one
   * being down makes it degraded, which still reports 200 — see the class note.
   */
  private aggregate(checks: Record<string, DependencyCheck>): HealthStatus {
    const values = Object.values(checks);
    if (values.some((check) => check.required && check.status === 'down')) return 'unavailable';
    if (values.some((check) => check.status === 'down')) return 'degraded';
    return 'ok';
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    const latencyMs = await this.prisma.ping();
    return latencyMs === null
      ? { status: 'down', latencyMs: null, required: true, message: 'Postgres is unreachable.' }
      : { status: 'up', latencyMs, required: true };
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const latencyMs = await this.redis.ping();
    return latencyMs === null
      ? {
          status: 'down',
          latencyMs: null,
          required: false,
          message:
            'Redis is unreachable. Serving in degraded mode: cache misses, fail-open rate limiting.',
        }
      : { status: 'up', latencyMs, required: false };
  }
}
