import { AppConfigService } from '../../src/config/app-config.service';
import type { Env } from '../../src/config/env.schema';

/**
 * Builds an `AppConfigService` from only the fields a test cares about.
 *
 * The real service is a typed accessor over a fully validated environment, and
 * that validation has its own tests. Here only the accessors under test matter,
 * so a partial object is cast rather than assembling a complete environment
 * literal — sixty lines of configuration that no reader would check anyway, and
 * which would silently rot the moment a field is added.
 */
export function testConfig(overrides: Partial<Env> = {}): AppConfigService {
  return new AppConfigService({
    APP_NAME: 'MediChain',
    SMTP_HOST: '',
    SMTP_PORT: 1025,
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_FROM: 'MediChain <no-reply@medichain.local>',
    SMS_PROVIDER: 'console',
    SMS_API_KEY: '',
    SMS_SENDER_ID: '',
    TWILIO_ACCOUNT_SID: '',
    ...overrides,
  } as Env);
}
