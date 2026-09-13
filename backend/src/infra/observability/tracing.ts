import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * OpenTelemetry tracing.
 *
 * ## Why this is started from a preload, not from `main.ts`
 *
 * Auto-instrumentation works by hooking the module loader: it wraps `http`,
 * `express`, `pg` and the rest *as they are required*. Starting the SDK after
 * Nest has already imported those modules is too late — the hooks never fire and
 * the result is a tracing setup that appears configured and produces almost
 * nothing. So it is started from `tracing-preload.ts`, which is loaded with
 * `node -r … ./dist/main.js` before any application module.
 *
 * `tracing-preload.ts` reads the environment directly rather than through
 * `AppConfigService`, because it must run before the configuration module exists.
 */
let sdk: NodeSDK | undefined;

export interface TracingOptions {
  readonly serviceName: string;
  readonly endpoint: string;
}

/** Starts tracing. Idempotent — a second call is a no-op. */
export function startTracing(options: TracingOptions): void {
  if (sdk !== undefined) return;

  sdk = new NodeSDK({
    serviceName: options.serviceName,
    traceExporter: new OTLPTraceExporter({
      // The OTLP/HTTP exporter expects the signal path appended to the base
      // endpoint, so `http://collector:4318` becomes `…/v1/traces`.
      url: `${options.endpoint.replace(/\/+$/, '')}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are produced for every `readFile`, which on this
        // service is dominated by module loading at boot. Extremely high volume,
        // no operational signal — disabled per the instrumentation's own docs.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export function isTracingStarted(): boolean {
  return sdk !== undefined;
}

/**
 * Flushes buffered spans and stops the SDK.
 *
 * Called on shutdown so spans for the final requests are exported rather than
 * lost — the requests most likely to explain an incident are the last ones
 * before a crash or a deploy.
 */
export async function shutdownTracing(): Promise<void> {
  const active = sdk;
  if (active === undefined) return;

  // Cleared before awaiting so a concurrent shutdown sees it as already stopped.
  sdk = undefined;
  await active.shutdown();
}
