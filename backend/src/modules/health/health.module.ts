import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Health module.
 *
 * Imports nothing: `PrismaService` and `RedisService` are provided by global
 * infrastructure modules, so this module only declares its own controller and
 * service. A health module that had to import half the application to check its
 * dependencies would itself become a reason the application fails to start.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
