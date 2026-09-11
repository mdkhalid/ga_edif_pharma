import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public, RawResponse } from '../../common/decorators';
import { HealthService, type HealthReport } from './health.service';

/**
 * Health endpoints.
 *
 * Mounted outside the `/api/v1` prefix (see `main.ts`) so a probe URL is short
 * and stable and does not change when the API version does. A probe that has to
 * be updated when the API version bumps is a probe that gets forgotten.
 *
 * ## Why the status code is set manually
 *
 * The whole point of `/health/ready` is the status code: 503 makes a load
 * balancer stop routing, 200 keeps traffic flowing. Nest's default is 200 for a
 * `@Get`, so the code is set from the report. `passthrough: true` keeps Nest's
 * serialisation, so the body still goes through the normal response pipeline.
 *
 * These are also marked `@Public()` — a probe cannot authenticate, and an
 * orchestrator that must hold a token to ask "are you alive?" is an orchestrator
 * with a token to rotate and a probe that fails when it expires.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Public()
  @RawResponse()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns 200 while the process is running. Never checks dependencies — a restart ' +
      'cannot fix a database outage, and failing here would crash-loop the whole fleet.',
  })
  @ApiResponse({ status: 200, description: 'The process is alive.' })
  live(): ReturnType<HealthService['live']> {
    return this.health.live();
  }

  @Get('ready')
  @Public()
  @RawResponse()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Returns 200 when the pod can serve traffic, 503 when a required dependency ' +
      '(Postgres) is unavailable. A degraded optional dependency (Redis) still returns 200.',
  })
  @ApiResponse({ status: 200, description: 'Ready to serve traffic.' })
  @ApiResponse({ status: 503, description: 'A required dependency is unavailable.' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const report = await this.health.ready();
    response.status(
      report.status === 'unavailable' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK,
    );
    return report;
  }

  /**
   * Alias of `/health/ready` at the bare `/health` path.
   *
   * Load balancers, uptime monitors and container platforms each default to a
   * different path. Providing the common one saves every operator from writing a
   * custom check the first time they point a new tool at the service.
   */
  @Get()
  @Public()
  @RawResponse()
  @ApiOperation({ summary: 'Readiness (alias of /health/ready)' })
  async root(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const report = await this.health.ready();
    response.status(
      report.status === 'unavailable' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK,
    );
    return report;
  }
}
