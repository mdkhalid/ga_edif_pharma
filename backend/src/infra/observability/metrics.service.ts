import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import { AppConfigService } from '../../config/app-config.service';

/**
 * The Prometheus registry and the metrics this service exposes.
 *
 * ## Why a private registry, not the global default
 *
 * `prom-client` keeps a process-global registry. Tests that construct this
 * service more than once would then collide on duplicate metric names — a
 * failure that looks like a bug in the metric, not in the test. An owned
 * registry also makes the exposed surface explicit: what is scraped is exactly
 * what is registered here.
 *
 * ## Why the route label is a *pattern*
 *
 * Labelling by URL (`/api/v1/orders/8f3c…`) creates a new time series per order
 * id. That is the classic Prometheus cardinality explosion: the scrape payload
 * grows without bound and the metrics backend falls over. The route pattern
 * (`/api/v1/orders/:id`) groups correctly — the same reasoning as the log line
 * in `LoggingInterceptor`.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly duration: Histogram<'method' | 'route' | 'status'>;
  private readonly requests: Counter<'method' | 'route' | 'status'>;

  constructor(config: AppConfigService) {
    this.registry.setDefaultLabels({
      service: config.appName,
      env: config.nodeEnv,
      role: config.appRole,
    });

    // Process metrics: CPU, event-loop lag, heap, GC, file descriptors. These
    // are the USE metrics an operator needs and none of them cost a line of code
    // per endpoint.
    collectDefaultMetrics({ register: this.registry });

    this.duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds, by method, route pattern and status.',
      labelNames: ['method', 'route', 'status'],
      // Spans the SLOs in docs/16: 200 ms reads, 800 ms writes. The buckets are
      // finer below 1 s because that is where every alert threshold lives.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.requests = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests, by method, route pattern and status.',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });
  }

  /** Records one completed request. Safe to call from an interceptor's tap. */
  observe(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = { method, route, status: String(status) };
    this.requests.inc(labels);
    this.duration.observe(labels, durationSeconds);
  }

  /** Renders the registry in the Prometheus text exposition format. */
  render(): Promise<string> {
    return this.registry.metrics();
  }

  /** The `Content-Type` Prometheus expects, including the format version. */
  get contentType(): string {
    return this.registry.contentType;
  }
}
