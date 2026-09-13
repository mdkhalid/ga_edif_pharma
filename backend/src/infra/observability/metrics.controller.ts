import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public, RawResponse } from '../../common/decorators';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint.
 *
 * Mounted outside the `/api/v1` prefix (see `main.ts`), so the scrape path is
 * `/metrics` — a Prometheus config that has to change when the API version bumps
 * is a config that gets forgotten.
 *
 * `@Public()` because a scraper cannot hold a JWT. The endpoint is therefore
 * reachable without authentication, which is why it exposes only aggregate
 * counters: no labels carry a user id, a tenant id or anything else that would
 * make the scrape a data-disclosure channel.
 */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Public()
  @RawResponse()
  @ApiOperation({
    summary: 'Prometheus metrics',
    description:
      'Returns the metrics registry in the Prometheus text exposition format. ' +
      'Mounted at /metrics, outside the versioned API prefix.',
  })
  @ApiOkResponse({ description: 'Prometheus text exposition format.' })
  async scrape(@Res() response: Response): Promise<void> {
    // Written directly rather than returned, because the body is not JSON and
    // must not pass through the response envelope or serialisation.
    response.setHeader('Content-Type', this.metrics.contentType);
    response.send(await this.metrics.render());
  }
}
