import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { firstValueFrom, of, throwError } from 'rxjs';

import { statusOfError } from '../../src/common/utils/error-status.util';
import type { AppConfigService } from '../../src/config/app-config.service';
import { MetricsController } from '../../src/infra/observability/metrics.controller';
import { MetricsInterceptor } from '../../src/infra/observability/metrics.interceptor';
import { MetricsService } from '../../src/infra/observability/metrics.service';
import {
  captureException,
  initSentry,
  isSentryEnabled,
} from '../../src/infra/observability/sentry';
import { SentryErrorReporter } from '../../src/infra/observability/sentry-error-reporter';

/** Only the accessors `MetricsService` reads. */
const config = {
  appName: 'MediChain-Test',
  nodeEnv: 'test',
  appRole: 'api',
} as unknown as AppConfigService;

function makeContext(
  request: Record<string, unknown>,
  response: Record<string, unknown> = {},
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsService', () => {
  it('exposes request counters and durations with default labels', async () => {
    const metrics = new MetricsService(config);
    metrics.observe('GET', '/health/live', 200, 0.012);

    const text = await metrics.render();

    expect(text).toContain('http_requests_total');
    expect(text).toContain('http_request_duration_seconds');
    expect(text).toContain('service="MediChain-Test"');
    expect(text).toContain('route="/health/live"');
  });

  it('advertises the Prometheus content type', () => {
    expect(new MetricsService(config).contentType).toContain('text/plain');
  });
});

describe('MetricsInterceptor', () => {
  it('records a successful request against the route pattern', async () => {
    const metrics = new MetricsService(config);
    const observe = jest.spyOn(metrics, 'observe');
    const interceptor = new MetricsInterceptor(metrics);
    const response = { statusCode: 200 };

    const handler: CallHandler = { handle: () => of('ok') };
    await firstValueFrom(
      interceptor.intercept(makeContext({ method: 'GET', route: { path: '/health/live' } }, response), handler),
    );

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith('GET', '/health/live', 200, expect.any(Number));
  });

  it('records the resolved status when the handler throws', async () => {
    const metrics = new MetricsService(config);
    const observe = jest.spyOn(metrics, 'observe');
    const interceptor = new MetricsInterceptor(metrics);

    const handler: CallHandler = { handle: () => throwError(() => new Error('boom')) };
    await expect(
      firstValueFrom(
        interceptor.intercept(makeContext({ method: 'POST', route: { path: '/auth/register' } }), handler),
      ),
    ).rejects.toThrow('boom');

    expect(observe).toHaveBeenCalledWith('POST', '/auth/register', 500, expect.any(Number));
  });
});

describe('MetricsController', () => {
  it('writes the registry with the Prometheus content type', async () => {
    const controller = new MetricsController(new MetricsService(config));
    const response = { setHeader: jest.fn(), send: jest.fn() };

    await controller.scrape(response as unknown as Response);

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringContaining('text/plain'),
    );
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('http_requests_total'));
  });
});

describe('statusOfError', () => {
  it('prefers getStatus()', () => {
    expect(statusOfError({ getStatus: () => 418 })).toBe(418);
  });

  it('falls back to httpStatus', () => {
    expect(statusOfError({ httpStatus: 429 })).toBe(429);
  });

  it('defaults to 500 for anything else', () => {
    expect(statusOfError(new Error('boom'))).toBe(500);
    expect(statusOfError(null)).toBe(500);
    expect(statusOfError('a string')).toBe(500);
  });
});

describe('Sentry reporter', () => {
  it('stays inert without a DSN', () => {
    expect(initSentry({ dsn: '   ', environment: 'test' })).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });

  it('captureException never throws while disabled', () => {
    expect(() => captureException(new Error('boom'), { correlationId: 'c1' })).not.toThrow();
  });

  it('the ErrorReporter adapter is a no-op while disabled', () => {
    const reporter = new SentryErrorReporter();
    expect(() => reporter.report(new Error('boom'), { status: 500 })).not.toThrow();
  });
});
