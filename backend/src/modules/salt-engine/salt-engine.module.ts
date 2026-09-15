import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { SaltEngineService } from './application/salt-engine.service';

/**
 * Salt engine bounded context. Reached through `./index`, never by deep
 * import. The service is exported so the `search` module can use it over
 * the barrel.
 */
@Module({
  imports: [DatabaseModule],
  providers: [SaltEngineService],
  exports: [SaltEngineService],
})
export class SaltEngineModule {}
