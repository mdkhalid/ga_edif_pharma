import { Global, Module } from '@nestjs/common';

import { AppLogger } from './app-logger.service';

/**
 * Logger module.
 *
 * `@Global()` because the logger is genuinely universal: the exception filter,
 * the logging interceptor, the guards and every service use it. Importing it in
 * each of them would add noise to every module's imports without expressing
 * anything — nothing configures the logger differently per module.
 *
 * Provided as a singleton so the pino instance, its transport and its redaction
 * configuration are constructed once per process. A logger per module would mean
 * one worker thread per pino-pretty transport in development, which is a
 * surprisingly expensive way to print a line.
 */
@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
