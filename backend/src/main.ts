import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { AppConfigService } from './config/app-config.service';

/**
 * Application bootstrap.
 *
 * ## One artifact, three roles
 *
 * The same build runs as `api`, `worker` or `scheduler`, selected by `APP_ROLE`.
 * A single artifact means a single dependency tree, a single security patch and
 * a single deploy — which removes the drift that appears the moment a worker
 * image is built from a slightly different commit than the API.
 *
 * The role changes what the process *does*, not what it *contains*:
 *
 *   - `api` binds a port and serves HTTP.
 *   - `worker` consumes queues and binds nothing.
 *   - `scheduler` runs cron jobs under a distributed lock and binds nothing.
 *
 * The module graph is identical, which is deliberate: a worker that cannot see
 * the same domain services as the API is a worker that re-implements them
 * slightly differently.
 *
 * ## Why the port is only bound for the `api` role
 *
 * A worker that binds a port looks healthy to a load balancer and then serves
 * requests it has no middleware for. Not binding at all means a misconfigured
 * deployment fails immediately and visibly, rather than accepting traffic it
 * cannot correctly handle.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffered until the real logger is attached, so nothing is printed twice
    // and no startup line is lost during the swap.
    bufferLogs: true,
    // `rawBody` is required for webhook signature verification: a gateway signs
    // the exact bytes it sent, and a re-serialised object will not match.
    rawBody: true,
  });

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const config = app.get(AppConfigService);

  // -------------------------------------------------------------------- HTTP
  //
  // `trust proxy` is enabled because the API runs behind a load balancer. Without
  // it, `req.ip` is the balancer's address and every rate-limit key collapses
  // into one bucket — so one noisy client throttles the entire platform.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Swagger UI needs inline scripts and styles; the API itself does not.
      // Disabling CSP only in non-production keeps the docs usable without
      // weakening the headers where it matters.
      contentSecurityPolicy: config.isProduction ? undefined : false,
      // HSTS is set by the edge, which knows the real scheme. Setting it here
      // behind a TLS-terminating balancer can produce a redirect loop.
      hsts: config.isProduction,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({
    // An explicit allow-list from validated configuration. `origin: true`
    // reflects whatever the caller sends, which with credentials enabled means
    // any site can make authenticated requests on the user's behalf.
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Request-Id',
      'X-Correlation-Id',
      'X-App-Version',
      'X-App-Platform',
      'X-Device-Id',
    ],
    // So the client can read the correlation id back and quote it in a support
    // request — which is what makes a bug report traceable.
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id', 'Retry-After', 'X-RateLimit-Remaining'],
    maxAge: 86_400,
  });

  // --------------------------------------------------------------- prefixes
  //
  // Health and metrics are mounted outside the version prefix. A probe URL that
  // has to change when the API version bumps is a probe that gets forgotten.
  app.setGlobalPrefix(config.apiPrefix, {
    exclude: ['health', 'health/live', 'health/ready', 'metrics'],
  });

  // Belt and braces: the global pipe is registered in `AppModule`, but a pipe
  // applied here also covers controllers that bypass the module graph (a
  // dynamically registered controller, for instance).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // ----------------------------------------------------------- shutdown
  //
  // Without this, `SIGTERM` during a rolling deploy kills the process
  // immediately: in-flight requests are cut off, transactions are left open on
  // the server until their idle timeout, and the outbox relay stops mid-batch.
  // With it, Nest calls `onModuleDestroy` on every provider, which is where the
  // Prisma and Redis clients drain.
  app.enableShutdownHooks();

  // ------------------------------------------------------------- swagger
  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('MediChain API')
        .setDescription(
          'Pharma distribution and ordering platform. Errors follow RFC 9457 ' +
            '(`application/problem+json`); collections are always paginated.',
        )
        .setVersion('0.1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'bearer',
        )
        .addTag('auth', 'Registration, sign-in, token rotation and sessions')
        .addTag('health', 'Liveness and readiness probes')
        .build(),
      { operationIdFactory: (_controller, method) => method },
    );

    SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
    });
  }

  // ----------------------------------------------------------------- listen
  if (config.isApiRole) {
    await app.listen(config.port, '0.0.0.0');
    logger.log(
      `${config.appName} API listening on port ${config.port} (${config.nodeEnv}). ` +
        `Prefix: /${config.apiPrefix}`,
    );
  } else {
    // The process stays alive with no listening socket: the queue consumers and
    // schedulers registered by the module graph are already running.
    logger.log(`${config.appName} started in "${config.appRole}" role — no HTTP port is bound.`);
  }
}

bootstrap().catch((error: unknown) => {
  // Deliberately `console.error` rather than the injected logger: if bootstrap
  // failed, the logger may be the thing that failed, and a failure to report a
  // failure is the worst outcome. `process.exit(1)` ensures the orchestrator
  // sees a non-zero exit and restarts the pod instead of leaving a half-started
  // process holding a port.
  console.error('Fatal error during application bootstrap:');
  console.error(error);
  process.exit(1);
});
