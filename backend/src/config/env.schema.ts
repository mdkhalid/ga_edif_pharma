import { z } from 'zod';

/**
 * Environment schema.
 *
 * Everything here is validated at BOOT, not at first use. A service that starts
 * successfully and then fails on the first request is far worse than one that
 * refuses to start: the orchestrator sees a crash-looping pod immediately,
 * whereas a runtime failure surfaces as intermittent 500s in production.
 *
 * This is Layer 1 configuration only (see docs/13). Anything an operator must
 * be able to change WITHOUT a redeploy — AI provider, API keys, business rules —
 * belongs in `platform_setting`, not here.
 */

/** Explicit boolean parsing. `z.coerce.boolean()` would treat "false" as true. */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1' || value === 'yes');

const commaSeparated = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

export const envSchema = z
  .object({
    // ---------------------------------------------------------------- app
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    /**
     * One build artifact, three runtime roles. `api` serves HTTP; `worker`
     * consumes queues; `scheduler` runs crons. One version, one deploy, one
     * dependency tree — which removes an entire class of drift.
     */
    APP_ROLE: z.enum(['api', 'worker', 'scheduler']).default('api'),
    API_PREFIX: z.string().default('api/v1'),
    APP_NAME: z.string().default('MediChain'),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3001'),

    // ----------------------------------------------------------- database
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(2),
    /**
     * Must satisfy: pool_max x pod_count < Postgres max_connections - reserved.
     * At 12 pods with pool_max=20 that is 240 connections against a default
     * limit of 200. Postgres then refuses connections and pods crash-loop,
     * which looks like a database failure but is a configuration failure.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(20),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    DATABASE_IDLE_IN_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    DATABASE_SYNCHRONIZE: booleanFromEnv(false),

    // -------------------------------------------------------------- redis
    REDIS_URL: z.string().min(1),
    REDIS_KEY_PREFIX: z.string().default('medichain:'),

    // ------------------------------------------------------------- search
    SEARCH_USE_OPENSEARCH: booleanFromEnv(false),
    OPENSEARCH_URL: z.string().default('http://localhost:9200'),
    OPENSEARCH_USERNAME: z.string().default('admin'),
    OPENSEARCH_PASSWORD: z.string().default('admin'),

    // ------------------------------------------------------------- storage
    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().default('medichain-dev'),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    S3_FORCE_PATH_STYLE: booleanFromEnv(true),

    // ---------------------------------------------------------------- auth
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_TTL: z.string().default('30d'),
    JWT_ISSUER: z.string().default('medichain'),
    JWT_AUDIENCE: z.string().default('medichain-api'),
    /** 32-byte base64 key. Protects every Layer 2 secret stored in the database. */
    ENCRYPTION_KEY: z.string().min(1),
    ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
    MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
    ACCOUNT_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    /** Lifetime of a contact-verification or password-reset code. */
    AUTH_OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    /** Guesses allowed against one code before it must be reissued. */
    AUTH_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    /**
     * Returns one-time codes in the API response body. Development only — it
     * exists so the verification and reset flows are driveable without a mail or
     * SMS transport. The env schema refuses it in production.
     */
    AUTH_EXPOSE_OTP_IN_RESPONSE: booleanFromEnv(false),

    // ------------------------------------------------------- rate limiting
    RATE_LIMIT_ENABLED: booleanFromEnv(true),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_DEFAULT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().positive().default(120),

    // ---------------------------------------------------------------- cors
    CORS_ORIGINS: commaSeparated,

    // ------------------------------------------------------- notifications
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.string().default('MediChain <no-reply@medichain.local>'),
    SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),
    SMS_API_KEY: z.string().default(''),
    WHATSAPP_PROVIDER: z.enum(['none', 'cloud-api']).default('none'),
    WHATSAPP_TOKEN: z.string().default(''),

    // ---------------------------------------------------- payment gateways
    PAYMENT_DEFAULT_PROVIDER: z
      .enum(['mock', 'razorpay', 'stripe', 'payu'])
      .default('mock'),
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

    // --------------------------------------------------------------- ai
    // Bootstrap defaults only. Admins add and switch providers live from
    // Admin -> Settings -> AI Providers, with no redeploy.
    AI_ENABLED: booleanFromEnv(false),
    AI_DEFAULT_PROVIDER: z
      .enum(['openai', 'anthropic', 'azure-openai', 'bedrock', 'ollama', 'custom'])
      .default('openai'),
    AI_DEFAULT_MODEL: z.string().default('gpt-4o-mini'),
    AI_API_KEY: z.string().default(''),
    AI_BASE_URL: z.string().default(''),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(200),
    AI_FEATURES__PRESCRIPTION_OCR: booleanFromEnv(false),
    AI_FEATURES__SEMANTIC_SEARCH: booleanFromEnv(false),
    AI_FEATURES__DEMAND_FORECAST: booleanFromEnv(false),
    AI_FEATURES__DESCRIPTION_ENRICH: booleanFromEnv(false),

    // ------------------------------------------------------ observability
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    OTEL_ENABLED: booleanFromEnv(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
    SENTRY_DSN: z.string().default(''),

    // ----------------------------------------------------- feature flags
    // Bootstrap defaults. Runtime values live in the `feature_flag` table.
    FF_MOBILE_APP_ENABLED: booleanFromEnv(true),
    FF_ONLINE_PAYMENTS_ENABLED: booleanFromEnv(false),
    FF_CREDIT_ORDERS_ENABLED: booleanFromEnv(true),
    FF_MULTI_WAREHOUSE: booleanFromEnv(false),
    FF_SALT_SMART_SUGGEST: booleanFromEnv(true),
  })
  .superRefine((env, ctx) => {
    // ------------------------------------------------------------------
    // Fail the BOOT, not the first request, on dangerous combinations.
    // ------------------------------------------------------------------

    if (env.NODE_ENV === 'production') {
      if (env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message:
            'Wildcard CORS origin is not permitted in production. Browsers reject "*" alongside credentials, and it would mean any origin can make credentialed requests.',
        });
      }

      if (env.DATABASE_SYNCHRONIZE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_SYNCHRONIZE'],
          message:
            'DATABASE_SYNCHRONIZE must be false in production — schema drift is a self-inflicted outage.',
        });
      }

      if (env.SMS_PROVIDER === 'console') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMS_PROVIDER'],
          message: 'The console SMS provider writes to stdout and must not be used in production.',
        });
      }

      if (env.AUTH_EXPOSE_OTP_IN_RESPONSE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_EXPOSE_OTP_IN_RESPONSE'],
          message:
            'AUTH_EXPOSE_OTP_IN_RESPONSE returns live one-time codes in the response body. That is an account takeover for anyone who can read a response, and must be false in production.',
        });
      }

      if (env.AI_ENABLED && env.AI_API_KEY === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_API_KEY'],
          message:
            'AI_ENABLED is true but AI_API_KEY is empty. Configure a key or disable AI — do not start in a half-configured state.',
        });
      }
    }

    if (env.CORS_ORIGINS.length === 0 && env.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'At least one CORS origin must be configured (comma separated).',
      });
    }

    // A placeholder secret in a real environment is worse than no secret:
    // it looks configured.
    const placeholderPattern = /^replace-me/i;
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const) {
      if (placeholderPattern.test(env[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still holds the placeholder value from .env.example. Generate a real secret.`,
        });
      }
    }

    // ENCRYPTION_KEY protects every Layer 2 secret at rest. A wrong-length key
    // fails at the first decrypt, which is far too late.
    const decoded = Buffer.from(env.ENCRYPTION_KEY, 'base64');
    if (decoded.length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message: `ENCRYPTION_KEY must be 32 bytes base64-encoded (got ${decoded.length} bytes). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      });
    }

    if (env.DATABASE_POOL_MIN > env.DATABASE_POOL_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_POOL_MIN'],
        message: 'DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates the environment, producing an actionable message rather than a
 * stack trace at 3 AM.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration. Fix the following and restart:\n${details}`,
    );
  }

  return result.data;
}
