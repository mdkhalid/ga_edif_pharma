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
    // Operation ids become the keys of the generated `operations` interface, and
    // `openapi-typescript` keys that interface by id alone — so an id must be
    // unique across the whole document, not merely within its controller.
    //
    // The bare method name stopped being unique as soon as a second controller
    // exposed `list`: catalogue and orders both do, and so do catalogue and cart
    // for `update`, and catalogue and orders for `getById`. The failure is not
    // loud — the generated file gets duplicate interface members, which either
    // fails the client's typecheck with "Duplicate identifier", or, where the two
    // signatures happen to line up, silently keeps the later declaration and
    // types one operation as the other.
    //
    // Qualifying with the controller's resource fixes both: `CatalogController`
    // plus `list` becomes `catalogList`, and `OrdersController` plus `list`
    // becomes `ordersList`. The route's tag still groups operations by resource
    // for humans; this is the machine-readable half.
    operationIdFactory: (controller, method) => {
      const resource = controller.replace(/Controller$/, '');
      const noun = resource.charAt(0).toLowerCase() + resource.slice(1);
      const verb = method.charAt(0).toUpperCase() + method.slice(1);
      return `${noun}${verb}`;
    },
  });
}
