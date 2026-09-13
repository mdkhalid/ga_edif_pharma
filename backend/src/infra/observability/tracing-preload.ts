/**
 * Tracing preload module.
 *
 * Loaded before the application, by the process's `-r` flag:
 *
 *   node -r ./dist/infra/observability/tracing-preload.js dist/main.js
 *
 * ## Why it reads `process.env` directly
 *
 * It must run before Nest, and therefore before `AppConfigModule` validates and
 * exposes the environment. Reaching into `process.env` here is the one place
 * that is unavoidable; every other component reads configuration through
 * `AppConfigService`.
 *
 * The flag test mirrors the `booleanFromEnv` parser in `env.schema.ts`. It is
 * duplicated rather than imported because importing the schema would pull the
 * whole configuration module — and Zod — in front of the instrumentation it is
 * supposed to start.
 */
import { startTracing } from './tracing';

const TRUTHY = new Set(['true', '1', 'yes', 'on']);

const enabled = TRUTHY.has((process.env['OTEL_ENABLED'] ?? '').trim().toLowerCase());

if (enabled) {
  startTracing({
    serviceName: process.env['APP_NAME'] ?? 'MediChain',
    endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318',
  });
}
