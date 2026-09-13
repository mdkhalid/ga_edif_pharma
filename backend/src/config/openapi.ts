import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Builds the OpenAPI document.
 *
 * Extracted from `main.ts` so the running server (which serves Swagger UI) and
 * the generation script (which CI runs to produce a committed spec) build the
 * document from **one** definition. Two definitions drift the moment a tag or a
 * security scheme is added to one and not the other, and the drift stays
 * invisible until a client is generated from the stale copy.
 *
 * Takes any `INestApplication`, so a script can create an application with the
 * logger disabled and never bind a port.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('MediChain API')
    .setDescription(
      'Pharma distribution and ordering platform. Errors follow RFC 9457 ' +
        '(`application/problem+json`); collections are always paginated.',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addTag('auth', 'Registration, sign-in, token rotation and sessions')
    .addTag('health', 'Liveness and readiness probes')
    .addTag('metrics', 'Prometheus metrics scrape endpoint')
    .build();

  return SwaggerModule.createDocument(app, config, {
    // Operation ids become the generated client's method names. The controller
    // prefix is noise there and is already carried by the route's tag.
    operationIdFactory: (_controller, method) => method,
  });
}
